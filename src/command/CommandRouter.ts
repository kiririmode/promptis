import * as vscode from "vscode";
import type { PromptMetadata } from "../util";
import { DiffReviewCommandHandler } from "./DiffReviewCommandHandler";
import { FileBasedReviewCommandHandler } from "./FileBasedReviewCommandHandler";

/**
 * レビューコマンドハンドラーのインターフェース
 * 各コマンドはこのインターフェースを実装する
 */
export interface ReviewCommandHandler {
  /**
   * コマンドを処理する
   * @param request - チャットリクエスト
   * @param context - チャットコンテキスト
   * @param stream - レスポンスストリーム
   * @param token - キャンセルトークン
   * @param promptMetadata - プロンプトメタデータ配列
   */
  handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    promptMetadata: PromptMetadata[]
  ): Promise<void | vscode.ChatResult>;
}

/**
 * コマンドルーティングを担当するクラス
 * Strategy/Factory パターンを使用して、コマンドを適切なハンドラーに振り分ける
 */
export class CommandRouter {
  private handlers: Map<string, ReviewCommandHandler>;

  constructor() {
    this.handlers = new Map<string, ReviewCommandHandler>([
      // 既存コマンドハンドラー（後方互換性）
      ["codereviewCodeStandards", new FileBasedReviewCommandHandler("codereviewCodeStandards")],
      ["codereviewFunctional", new FileBasedReviewCommandHandler("codereviewFunctional")],
      ["codereviewNonFunctional", new FileBasedReviewCommandHandler("codereviewNonFunctional")],
      ["reverseEngineering", new FileBasedReviewCommandHandler("reverseEngineering")],
      ["drawDiagrams", new FileBasedReviewCommandHandler("drawDiagrams")],

      // 新規差分レビューハンドラー
      ["codereviewDiff", new DiffReviewCommandHandler()],
    ]);
  }

  /**
   * コマンドに対応するハンドラーを取得
   * @param command - コマンド名
   * @returns ReviewCommandHandler または undefined
   */
  getHandler(command: string): ReviewCommandHandler | undefined {
    return this.handlers.get(command);
  }
}
