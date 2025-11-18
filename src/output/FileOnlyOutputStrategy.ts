import path from "path";
import * as vscode from "vscode";
import { FileChatResponseStreamWrapper } from "../chatutil";
import { OutputStrategy } from "./OutputStrategy";

/**
 * ファイル中心出力戦略
 * ChatWindowの出力を最小限に抑え、詳細はファイルに保存
 */
export class FileOnlyOutputStrategy implements OutputStrategy {
  /**
   * 開始時のみ簡潔なサマリー表示
   */
  outputProgress(counter: number, total: number, stream: vscode.ChatResponseStream): void {
    // 最初の処理時のみ全体のサマリーを表示
    if (counter === 0) {
      stream.markdown(`📝 Starting review for ${total} file(s). Results will be saved to file.\n`);
      stream.markdown(`----\n`);
    }
  }

  /**
   * 最小限の進捗表示（✅ prompt → target）
   */
  outputReviewDetails(promptFile: string, contentFilePath: string, stream: vscode.ChatResponseStream): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const promptName = workspaceRoot
      ? path.relative(workspaceRoot, promptFile)
      : path.basename(promptFile);
    const targetName = workspaceRoot
      ? path.relative(workspaceRoot, contentFilePath)
      : path.basename(contentFilePath);

    stream.markdown(`✅ ${promptName} → ${targetName}\n`);
  }

  /**
   * ChatWindow非経由でファイル直接出力
   * content配列にのみ蓄積し、ChatWindowには出力しない
   */
  async outputReviewResult(fragments: AsyncIterable<string>, stream: vscode.ChatResponseStream): Promise<void> {
    if (stream instanceof FileChatResponseStreamWrapper) {
      // ファイル出力専用の場合は、ChatWindowを経由せずに直接ファイルに書き込み
      for await (const fragment of fragments) {
        stream.writeDirectToFile(fragment);
      }
    } else {
      // フォールバック: 通常のstream（テスト等）
      for await (const fragment of fragments) {
        stream.markdown(fragment);
      }
    }
  }
}