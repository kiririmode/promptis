import * as vscode from "vscode";

/**
 * 出力制御の戦略を定義するインターフェース
 * Strategy Patternを用いて出力先（ChatWindow、ファイル）の制御を分離
 */
export interface OutputStrategy {
  /**
   * 進捗情報を出力する
   * @param counter 現在の処理番号（0-based）
   * @param total 総処理数
   * @param stream ChatResponseStream
   */
  outputProgress(counter: number, total: number, stream: vscode.ChatResponseStream): void;

  /**
   * レビュー詳細情報を出力する
   * @param promptFile プロンプトファイルのパス
   * @param contentFilePath 対象ファイルのパス
   * @param stream ChatResponseStream
   */
  outputReviewDetails(promptFile: string, contentFilePath: string, stream: vscode.ChatResponseStream): void;

  /**
   * AIレビュー結果を出力する
   * @param fragments AIモデルからのレスポンス断片
   * @param stream ChatResponseStream
   */
  outputReviewResult(fragments: AsyncIterable<string>, stream: vscode.ChatResponseStream): Promise<void>;
}