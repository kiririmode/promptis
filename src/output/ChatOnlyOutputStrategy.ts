import path from "path";
import * as vscode from "vscode";
import { OutputStrategy } from "./OutputStrategy";

/**
 * ChatWindow詳細出力戦略
 * 従来の詳細な進捗表示とレビュー結果をChatWindowに出力する
 */
export class ChatOnlyOutputStrategy implements OutputStrategy {
  /**
   * 詳細な進捗情報をChatWindowに出力
   */
  outputProgress(counter: number, total: number, stream: vscode.ChatResponseStream): void {
    stream.markdown(`progress: ${counter + 1}/${total}\n`);
    stream.markdown(`----\n`);
  }

  /**
   * レビュー詳細情報をChatWindowに出力
   */
  outputReviewDetails(promptFile: string, contentFilePath: string, stream: vscode.ChatResponseStream): void {
    stream.markdown(`## Review Details \n\n`);

    // Workspaceのroot pathから相対パスで出力
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      stream.markdown(`- Prompt: ${path.relative(workspaceRoot, promptFile)}\n`);
      stream.markdown(`- Target: ${path.relative(workspaceRoot, contentFilePath)}\n`);
    } else {
      stream.markdown(`- Prompt: ${promptFile}\n`);
      stream.markdown(`- Target: ${contentFilePath}\n`);
    }
    stream.markdown(`----\n`);
  }

  /**
   * AIレビュー結果をChatWindowに直接出力
   */
  async outputReviewResult(fragments: AsyncIterable<string>, stream: vscode.ChatResponseStream): Promise<void> {
    for await (const fragment of fragments) {
      stream.markdown(fragment);
    }
  }
}