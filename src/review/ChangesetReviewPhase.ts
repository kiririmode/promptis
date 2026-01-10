import path from "path";
import * as vscode from "vscode";
import type { DiffResult } from "../gitUtil";
import type { FileReviewResult, PromptMetadataWithScope } from "./types";

/**
 * 変更集合全体のレビューフェーズ
 * scope: changeset のプロンプトを使用して、全体の整合性をチェック
 */
export class ChangesetReviewPhase {
  /**
   * 変更集合レビューを実行
   * @param diffResults - 差分結果の配列
   * @param fileReviewResults - ファイルレビュー結果の配列
   * @param promptMetadata - プロンプトメタデータ配列
   * @param model - 言語モデル
   * @param token - キャンセルトークン
   * @param stream - レスポンスストリーム
   * @param workspaceRoot - ワークスペースルート
   */
  async execute(
    diffResults: DiffResult[],
    fileReviewResults: FileReviewResult[],
    promptMetadata: PromptMetadataWithScope[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream,
    workspaceRoot: string
  ): Promise<void> {
    // scope: changeset のプロンプトのみ対象
    const changesetPrompts = promptMetadata.filter(p => p.scope === 'changeset');

    if (changesetPrompts.length === 0) {
      stream.markdown(`ℹ️ 変更集合レビュー用プロンプトが見つかりません\n\n`);
      return;
    }

    stream.markdown(`## 変更集合全体のレビュー\n\n`);
    stream.markdown(`適用可能なプロンプト: **${changesetPrompts.length}** 件\n\n`);

    // 各プロンプトで全体レビュー
    for (const prompt of changesetPrompts) {
      if (token.isCancellationRequested) {
        stream.markdown("\n⚠️ レビューがキャンセルされました\n");
        break;
      }

      await this.reviewWithPrompt(
        diffResults,
        fileReviewResults,
        prompt,
        model,
        token,
        stream
      );
    }
  }

  /**
   * プロンプトを使って変更集合全体をレビュー
   * @param diffResults - 差分結果の配列
   * @param fileReviewResults - ファイルレビュー結果の配列
   * @param prompt - プロンプトメタデータ
   * @param model - 言語モデル
   * @param token - キャンセルトークン
   * @param stream - レスポンスストリーム
   */
  private async reviewWithPrompt(
    diffResults: DiffResult[],
    fileReviewResults: FileReviewResult[],
    prompt: PromptMetadataWithScope,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream
  ): Promise<void> {
    // コンテキストを構築
    let context = `# 変更集合レビュー\n\n`;

    // 変更ファイル一覧
    context += `## 変更ファイル一覧\n\n`;
    for (const result of diffResults) {
      context += `- **${result.relativePath}** (${result.changeType}, ${result.fileExtension})\n`;
    }

    // 各ファイルの差分
    context += `\n## 各ファイルの差分\n\n`;
    for (const diff of diffResults) {
      context += `### ${diff.relativePath}\n\n`;
      context += `変更タイプ: **${diff.changeType}**\n\n`;
      context += `\`\`\`diff\n${diff.diff}\n\`\`\`\n\n`;
    }

    // プロンプトを送信
    const messages = [
      vscode.LanguageModelChatMessage.User(prompt.content),
      vscode.LanguageModelChatMessage.User(context),
    ];

    try {
      const promptName = path.basename(prompt.filePath);
      stream.markdown(`### レビュー: ${promptName}\n\n`);

      const response = await model.sendRequest(messages, {}, token);

      // ストリーミング出力
      for await (const chunk of response.text) {
        stream.markdown(chunk);
      }
      stream.markdown(`\n\n----\n\n`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Changeset review error:', error);
      stream.markdown(`❌ レビューエラー: ${errorMessage}\n\n`);
    }
  }
}
