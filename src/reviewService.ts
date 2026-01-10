import fs from "fs";
import path from "path";
import * as vscode from "vscode";
import { FileChatResponseStreamWrapper } from "./chatutil";
import { Config } from "./config";
import { OutputStrategyFactory } from "./output";
import { filterPromptsByTarget, type PromptMetadata } from "./util";

/**
 * エラーレスポンスを作成する
 */
export function createErrorResponse(message: string, stream: vscode.ChatResponseStream): vscode.ChatResult {
  console.debug(message);
  stream.markdown(message);
  return { errorDetails: { message } };
}

/**
 * 指定されたソースファイルを処理する非同期関数。
 *
 * @param {string[]} sourcePaths - 処理するソースファイルのパスの配列。
 * @param {PromptMetadata[]} promptMetadata - プロンプトメタデータの配列。
 * @param {vscode.LanguageModelChat} model - 使用するChat Model
 * @param {vscode.CancellationToken} token - キャンセルトークン。
 * @param {vscode.ChatResponseStream} stream - チャット用の Response Stream
 * @returns {Promise<void>} 処理が完了したことを示すPromise
 */
export async function processSourceFiles(
  sourcePaths: string[],
  promptMetadata: PromptMetadata[],
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const outputMode = Config.getOutputMode();
  const strategy = OutputStrategyFactory.create(outputMode);

  // ワークスペースルートを取得
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

  // まずフィルタリングを行い、処理対象とスキップ対象を分類
  const processableFiles: Array<{ sourcePath: string; applicablePrompts: PromptMetadata[] }> = [];
  const skippedFiles: string[] = [];

  for (const sourcePath of sourcePaths) {
    const applicablePrompts = filterPromptsByTarget(promptMetadata, sourcePath, workspaceRoot);
    if (applicablePrompts.length === 0) {
      // ワークスペースルートからの相対パスで記録
      const relativePath = workspaceRoot ? path.relative(workspaceRoot, sourcePath) : sourcePath;
      skippedFiles.push(relativePath);
    } else {
      processableFiles.push({ sourcePath, applicablePrompts });
    }
  }

  // 処理対象ファイルの総数
  const totalProcessable = processableFiles.length;

  // ソースファイルを軸にして、プロンプトを適用していく
  let processedCount = 0;
  for (const { sourcePath, applicablePrompts } of processableFiles) {
    strategy.outputProgress(processedCount, totalProcessable, stream);

    const content = fs.readFileSync(sourcePath, { encoding: "utf8" });

    stream.markdown(`Applying ${applicablePrompts.length} prompt(s) to ${path.basename(sourcePath)}\n`);
    await processContent(content, sourcePath, applicablePrompts, model, token, stream);
    processedCount++;
  }

  // スキップされたファイルをまとめて表示
  if (skippedFiles.length > 0) {
    stream.markdown(`\n⚠️ Skipped ${skippedFiles.length} file(s) with no matching prompts:\n`);
    for (const fileName of skippedFiles) {
      stream.markdown(`  - ${fileName}\n`);
    }
  }
}

/**
 * エディタ上で選択した内容をプロンプトで処理する
 *
 * @param {PromptMetadata[]} promptMetadata - プロンプトメタデータの配列。
 * @param {vscode.LanguageModelChat} model - 使用するChat Model
 * @param {vscode.CancellationToken} token - キャンセルトークン。
 * @param {vscode.ChatResponseStream} stream - チャット用の Response Stream
 * @returns {Promise<void | vscode.ChatResult>} 処理が完了したことを示すPromise、またはエラーが発生した場合はエラー情報を含む ChatResult
 */
export async function processSelectedContent(
  promptMetadata: PromptMetadata[],
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<void | vscode.ChatResult> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return createErrorResponse("No active editor", stream);
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    return createErrorResponse("No selection found", stream);
  }

  // 対象ファイルのパスを取得
  const contentFilePath = editor.document.uri.fsPath;
  // 選択された領域の内容を取得
  const content = editor.document.getText(selection);
  if (!content) {
    return createErrorResponse("No content found", stream);
  }

  // ワークスペースルートを取得
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

  // アクティブエディタのファイルパスを取得してフィルタリング
  const applicablePrompts = filterPromptsByTarget(promptMetadata, contentFilePath, workspaceRoot);

  if (applicablePrompts.length === 0) {
    stream.markdown(`⚠️ No prompts matched for file: ${path.basename(contentFilePath)}\n`);
    return;
  }

  stream.markdown(`Applying ${applicablePrompts.length} prompt(s) to selection\n`);
  await processContent(content, contentFilePath, applicablePrompts, model, token, stream);
}

/**
 * 指定されたコンテンツをプロンプトで処理し、その結果を Chat Viewに返却する
 *
 * @param {string} content - 処理対象の文字列
 * @param {string} contentFilePath - 処理対象となるファイルパス
 * @param {PromptMetadata[]} promptMetadata - プロンプトメタデータの配列。
 * @param {vscode.LanguageModelChat} model - 使用する Chat Model
 * @param {vscode.CancellationToken} token - キャンセルトークン。
 * @param {vscode.ChatResponseStream} stream -
 * @returns {Promise<void>} 処理が完了したことを示すプロミス。
 */
export async function processContent(
  content: string,
  contentFilePath: string,
  promptMetadata: PromptMetadata[],
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const outputMode = Config.getOutputMode();
  const strategy = OutputStrategyFactory.create(outputMode);

  for (const meta of promptMetadata) {
    const promptFile = meta.filePath;
    const promptContent = meta.content;
    const messages = [
      vscode.LanguageModelChatMessage.User(promptContent),
      vscode.LanguageModelChatMessage.User(content),
    ];

    try {
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

      // プロンプトを送信し、GitHub Copilot の AI モデルから応答を受信、出力する
      const res = await model.sendRequest(messages, {}, token);
      await strategy.outputReviewResult(res.text, stream);
    } catch (error) {
      if (error instanceof vscode.LanguageModelError) {
        switch (error.code) {
          case vscode.LanguageModelError.Blocked().code:
            console.error("Request blocked:", error);
            stream.markdown("Request blocked");
            break;

          case vscode.LanguageModelError.NoPermissions().code:
            console.error("No permissions:", error);
            stream.markdown("No permissions");
            break;

          case vscode.LanguageModelError.NotFound().code:
            console.error("Not found:", error);
            stream.markdown("Not found");
            break;

          default:
            console.error("Error processing content:", error.cause);
            stream.markdown(`Error processing content: ${error.cause}`);
        }
      }
      console.error("Error processing content:", error);
      stream.markdown(`Error processing content: ${error}`);
    } finally {
      stream.markdown("\n\n");
      if (stream instanceof FileChatResponseStreamWrapper) {
        stream.writeToFile();
        // writeToFile()内で既にclearContent()が呼ばれているが、
        // 明示的なリソース解放パターンとして、また将来的に
        // ファイルハンドル等の追加リソース管理の可能性を考慮してdispose()を呼び出す
        stream.dispose();
      }
    }
  }
}
