import * as vscode from "vscode";
import { processSelectedContent, processSourceFiles } from "../reviewService.js";
import { extractTargetFiles, type PromptMetadata } from "../util";
import type { ReviewCommandHandler } from "./CommandRouter";

/**
 * ファイルベースのレビューコマンドハンドラー
 * 既存のファイルレビュー機能をラップ
 */
export class FileBasedReviewCommandHandler implements ReviewCommandHandler {
  constructor(private commandName: string) {}

  /**
   * ファイルベースのレビューを実行
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
    // 既存のロジック: ターゲットファイルを抽出して処理
    const targetFiles = await extractTargetFiles(request, stream);

    if (targetFiles.length > 0) {
      // ファイル指定があれば、当該ファイルをレビュー
      await processSourceFiles(targetFiles, promptMetadata, request.model, token, stream);
    } else {
      // ファイル指定がなければ、エディタで選択されている内容をレビュー
      await processSelectedContent(promptMetadata, request.model, token, stream);
    }
  }
}
