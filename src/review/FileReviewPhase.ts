import path from "path";
import * as vscode from "vscode";
import type { DiffResult } from "../gitUtil";
import { filterPromptsByTarget } from "../util";
import type { FileReviewResult, PromptMetadataWithScope } from "./types";

/**
 * ファイル単位のレビューフェーズ
 * scope: file のプロンプトを使用して、各ファイルの差分を個別にレビュー
 */
export class FileReviewPhase {
  /**
   * ファイル単位レビューを実行
   * @param diffResults - 差分結果の配列
   * @param promptMetadata - プロンプトメタデータ配列
   * @param model - 言語モデル
   * @param token - キャンセルトークン
   * @param stream - レスポンスストリーム
   * @param workspaceRoot - ワークスペースルート
   * @returns ファイルレビュー結果の配列
   */
  async execute(
    diffResults: DiffResult[],
    promptMetadata: PromptMetadataWithScope[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream,
    workspaceRoot: string
  ): Promise<FileReviewResult[]> {
    const results: FileReviewResult[] = [];

    // scope: file のプロンプトのみ対象（未指定の場合はデフォルトで 'file' とみなす）
    const filePrompts = promptMetadata.filter(p => (p.scope ?? 'file') === 'file');

    if (filePrompts.length === 0) {
      stream.markdown(`⚠️ ファイル単位レビュー用プロンプトが見つかりません\n\n`);
      return results;
    }

    stream.markdown(`適用可能なファイル単位プロンプト: **${filePrompts.length}** 件\n\n`);

    // 各差分ファイルをレビュー
    for (const diffResult of diffResults) {
      if (token.isCancellationRequested) {
        stream.markdown("\n⚠️ レビューがキャンセルされました\n");
        break;
      }

      // 既存の filterPromptsByTarget() で該当プロンプトを取得
      const applicablePrompts = filterPromptsByTarget(
        filePrompts,
        diffResult.filePath,
        workspaceRoot
      );

      if (applicablePrompts.length === 0) {
        stream.markdown(`⚠️ **${diffResult.relativePath}**: マッチするプロンプトがありません\n\n`);
        continue;
      }

      // ファイルヘッダーを出力
      stream.markdown(`### ${diffResult.relativePath}\n\n`);
      stream.markdown(`変更タイプ: **${diffResult.changeType}** | プロンプト数: **${applicablePrompts.length}**\n\n`);

      // 各プロンプトでレビュー
      let allReviews = '';
      for (const prompt of applicablePrompts) {
        if (token.isCancellationRequested) {
          break;
        }

        const reviewText = await this.reviewWithPrompt(
          diffResult,
          prompt as PromptMetadataWithScope,
          model,
          token,
          stream
        );
        allReviews += reviewText + '\n\n';
      }

      // 結果を保存
      results.push({
        filePath: diffResult.filePath,
        relativePath: diffResult.relativePath,
        fileExtension: diffResult.fileExtension,
        diff: diffResult.diff,
        reviewText: allReviews,
      });

      stream.markdown(`----\n\n`);
    }

    return results;
  }

  /**
   * プロンプトを使って差分をレビュー
   * @param diffResult - 差分結果
   * @param prompt - プロンプトメタデータ
   * @param model - 言語モデル
   * @param token - キャンセルトークン
   * @param stream - レスポンスストリーム
   * @returns レビューテキスト
   */
  private async reviewWithPrompt(
    diffResult: DiffResult,
    prompt: PromptMetadataWithScope,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream
  ): Promise<string> {
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
      stream.markdown(`#### レビュー: ${promptName}\n\n`);

      // LLMに送信
      const response = await model.sendRequest(messages, {}, token);

      // ストリーミング出力
      let reviewText = '';
      for await (const chunk of response.text) {
        reviewText += chunk;
        stream.markdown(chunk);
      }
      stream.markdown('\n\n');

      return reviewText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Review error:', error);
      stream.markdown(`❌ レビューエラー: ${errorMessage}\n\n`);
      return `[エラー: ${errorMessage}]`;
    }
  }
}
