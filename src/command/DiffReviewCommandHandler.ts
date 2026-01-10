import path from "path";
import * as vscode from "vscode";
import { getDiffContent, getRepository, parseGitRange, type GitRange } from "../gitUtil";
import { filterPromptsByTarget, type PromptMetadata } from "../util";
import type { ReviewCommandHandler } from "./CommandRouter";

/**
 * 差分レビューコマンドハンドラー
 * Phase 1: シンプルなファイル単位レビュー
 */
export class DiffReviewCommandHandler implements ReviewCommandHandler {
  /**
   * 差分レビューを実行
   * @param request - チャットリクエスト
   * @param context - チャットコンテキスト
   * @param stream - レスポンスストリーム
   * @param token - キャンセルトークン
   * @param promptMetadata - プロンプトメタデータ配列
   */
  async handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    promptMetadata: PromptMetadata[]
  ): Promise<void | vscode.ChatResult> {
    // 1. Gitリポジトリを取得
    const repo = getRepository();
    if (!repo) {
      stream.markdown("⚠️ Gitリポジトリが見つかりません。Gitリポジトリ内で実行してください。\n");
      return { errorDetails: { message: "No Git repository found" } };
    }

    // 2. 差分範囲を取得
    const range = await this.extractDiffRange(request, repo);
    if (!range) {
      stream.markdown("⚠️ 差分範囲を特定できません。\n");
      return { errorDetails: { message: "Failed to determine diff range" } };
    }

    stream.markdown(`📊 **差分レビュー**: \`${range.base}...${range.compare}\`\n\n`);

    // 3. 差分を取得
    let diffResults;
    try {
      diffResults = await getDiffContent(repo, range);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stream.markdown(`❌ 差分取得エラー: ${errorMessage}\n`);
      return { errorDetails: { message: errorMessage } };
    }

    if (diffResults.length === 0) {
      stream.markdown(`ℹ️ \`${range.base}..${range.compare}\` 間に変更がありません。\n`);
      return;
    }

    stream.markdown(`変更されたファイル: **${diffResults.length}** 件\n\n`);
    stream.markdown(`----\n\n`);

    // ワークスペースルートを取得
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    // 4. 各差分ファイルをレビュー
    let reviewedCount = 0;
    const skippedFiles: string[] = [];

    for (const diffResult of diffResults) {
      if (token.isCancellationRequested) {
        stream.markdown("\n⚠️ レビューがキャンセルされました。\n");
        break;
      }

      // 該当するプロンプトを取得
      const applicablePrompts = filterPromptsByTarget(
        promptMetadata,
        diffResult.filePath,
        workspaceRoot
      );

      if (applicablePrompts.length === 0) {
        skippedFiles.push(diffResult.relativePath);
        continue;
      }

      // ファイルヘッダーを出力
      stream.markdown(`## ${diffResult.relativePath}\n\n`);
      stream.markdown(`変更タイプ: **${diffResult.changeType}**\n\n`);

      // 各プロンプトでレビュー
      for (const prompt of applicablePrompts) {
        if (token.isCancellationRequested) {
          break;
        }

        await this.reviewWithPrompt(diffResult, prompt, request.model, token, stream, workspaceRoot);
      }

      reviewedCount++;
      stream.markdown(`----\n\n`);
    }

    // サマリーを出力
    stream.markdown(`## レビュー完了\n\n`);
    stream.markdown(`- レビュー済み: **${reviewedCount}** ファイル\n`);

    if (skippedFiles.length > 0) {
      stream.markdown(`- スキップ: **${skippedFiles.length}** ファイル（マッチするプロンプトなし）\n`);
      stream.markdown(`\n⚠️ スキップされたファイル:\n`);
      for (const fileName of skippedFiles) {
        stream.markdown(`  - ${fileName}\n`);
      }
    }
  }

  /**
   * チャットリクエストから差分範囲指定を抽出
   * @param request - チャットリクエスト
   * @param repo - Gitリポジトリ
   * @returns GitRange または undefined
   */
  private async extractDiffRange(
    request: vscode.ChatRequest,
    repo: any
  ): Promise<GitRange | undefined> {
    // プロンプトから #range:spec を抽出
    const rangeMatch = request.prompt.match(/#range:(\S+)/);

    if (rangeMatch) {
      const rangeSpec = rangeMatch[1];
      try {
        return parseGitRange(rangeSpec);
      } catch (error) {
        console.error('Failed to parse range spec:', error);
        return undefined;
      }
    }

    // #range 指定なし → デフォルトを使用（origin/main...HEAD）
    try {
      const { getDefaultBaseBranch } = await import('../gitUtil.js');
      const defaultBase = await getDefaultBaseBranch(repo);
      return parseGitRange(undefined, defaultBase);
    } catch (error) {
      console.error('Failed to get default base branch:', error);
      return undefined;
    }
  }

  /**
   * プロンプトを使って差分をレビュー
   * @param diffResult - 差分結果
   * @param prompt - プロンプトメタデータ
   * @param model - 言語モデル
   * @param token - キャンセルトークン
   * @param stream - レスポンスストリーム
   * @param workspaceRoot - ワークスペースルート
   */
  private async reviewWithPrompt(
    diffResult: any,
    prompt: PromptMetadata,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream,
    workspaceRoot: string
  ): Promise<void> {
    // プロンプトを構築
    const messages = [
      vscode.LanguageModelChatMessage.User(prompt.content),
      vscode.LanguageModelChatMessage.User(
        `# ${diffResult.relativePath}\n\n\`\`\`diff\n${diffResult.diff}\n\`\`\``
      ),
    ];

    try {
      // プロンプト情報を出力
      const promptName = path.basename(prompt.filePath);
      stream.markdown(`### レビュー: ${promptName}\n\n`);

      // LLMに送信
      const response = await model.sendRequest(messages, {}, token);

      // ストリーミング出力
      for await (const chunk of response.text) {
        stream.markdown(chunk);
      }
      stream.markdown('\n\n');
    } catch (error) {
      if (error instanceof vscode.LanguageModelError) {
        console.error('Language model error:', error);
        stream.markdown(`❌ レビューエラー: ${error.message}\n\n`);
      } else {
        console.error('Unexpected error during review:', error);
        stream.markdown(`❌ 予期しないエラー: ${error}\n\n`);
      }
    }
  }
}
