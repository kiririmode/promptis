import path from "path";
import * as vscode from "vscode";
import { postUsage } from "./api";
import { FileChatResponseStreamWrapper } from "./chatutil";
import { CommandRouter } from "./command/CommandRouter";
import { Config } from "./config";
import { createErrorResponse } from "./reviewService";
import { findPromptFiles, parsePromptFile, timestampAsString } from "./util";

type CommandPromptPathMap = Map<string, () => string | undefined>;
const commandPromptDirectoryMap: CommandPromptPathMap = new Map([
  ["codereviewCodeStandards", Config.getCodeReviewStandardPath],
  ["codereviewFunctional", Config.getCodeReviewFunctionalPath],
  ["codereviewNonFunctional", Config.getCodeReviewNonFunctionalPath],
  ["reverseEngineering", Config.getReverseEngineeringPromptPath],
  ["drawDiagrams", Config.getDrawDiagramsPromptPath],
]);

/**
 * ユーザからのChat Requestを処理するハンドラ
 *
 * @param request - ユーザからの Chat Request
 * @param context - Chat Historyを持つコンテキスト
 * @param stream - ユーザに回答するための Chat Response Stream
 * @param token - やりとりをキャンセルする時に使用するトークン
 * @returns
 *
 * この関数は以下の手順で処理を行い、ユーザに回答を返す
 * 1. Chatに使用する AI Model を選択する
 * 2. ユーザから、コマンドが指定されているか確認する
 * 3. コマンドに対応するプロンプトの格納ディレクトリを取得する。
 * 4. 格納ディレクトリからプロンプトのファイルを取得する
 * 5. リクエストからターゲットファイルを抽出し、存在する場合はそれらを処理する
 * 6. ターゲットファイルが存在しない場合は、エディタで選択された内容を処理する
 * 7. デバッグ用にリクエストの詳細をコンソールに出力する。
 */
export const chatHandler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  // ユーザから、コマンドが指定されているか確認する
  const command = request.command;
  if (!command) {
    return createErrorResponse("No command specified", stream);
  }
  console.log(`Command: ${command}`);

  await postUsage(command);

  // CommandRouterでハンドラーを取得
  const router = new CommandRouter();
  const handler = router.getHandler(command);

  if (!handler) {
    return createErrorResponse(`Unknown command: ${command}`, stream);
  }

  // コマンドに対応するプロンプトの格納ディレクトリを取得する
  const promptDir = getPromptDirectory(command);
  if (!promptDir) {
    return createErrorResponse(`No prompt path found for command: ${command}`, stream);
  }
  console.info(`Prompt directory: ${promptDir}`);

  // 格納ディレクトリからプロンプトのファイルを取得する
  const promptFiles = findPromptFiles(promptDir, Config.getPromptExcludeFilePatterns());
  if (promptFiles.length === 0) {
    return createErrorResponse(`No prompt files found in ${promptDir}`, stream);
  }

  // プロンプトファイルのメタデータを解析
  const promptMetadata = promptFiles.map(parsePromptFile);

  const outputDirPath = Config.getChatOutputDirPath();
  const outputMode = Config.getOutputMode();

  // file-onlyモードでoutputPathが未設定の場合に警告
  warnIfFileOnlyWithoutOutputPath(outputMode, outputDirPath);

  // file-onlyモードの場合のみファイル出力を有効化
  if (outputMode === "file-only" && outputDirPath && outputDirPath.length > 0) {
    // ResponseStream をラップして、ファイルに保存するようにする
    stream = new FileChatResponseStreamWrapper(stream, makeChatFilePath(outputDirPath));
  }

  // ハンドラーに処理を委譲
  return await handler.handle(request, context, stream, token, promptMetadata);
};

export function getPromptDirectory(command: string): string | undefined {
  // 既存のマッピング
  const dir = commandPromptDirectoryMap.get(command)?.();
  if (dir) {
    return dir;
  }

  // 新規コマンド用の設定
  if (command === "codereviewDiff") {
    return Config.getCodeReviewDiffPath();
  }

  return undefined;
}

/**
 * file-onlyモードでoutputPathが未設定の場合に警告を表示
 * @param {string} outputMode - 出力モード
 * @param {string | undefined} outputDirPath - 出力ディレクトリパス
 */
export function warnIfFileOnlyWithoutOutputPath(
  outputMode: "chat-only" | "file-only",
  outputDirPath: string | undefined,
): void {
  if (outputMode === "file-only" && (!outputDirPath || outputDirPath.length === 0)) {
    vscode.window
      .showWarningMessage(
        "Output mode is set to 'file-only' but 'chat.outputPath' is not configured. Results will be displayed in chat window instead.",
        "Open Settings",
      )
      .then((selection) => {
        if (selection === "Open Settings") {
          vscode.commands.executeCommand("workbench.action.openSettings", "chat.outputPath");
        }
      });
  }
}

/**
 * チャット内容の保存先となるファイルパスを生成する
 *
 * @param {string} dirPath - 出力先ディレクトリのパス
 * @returns {string} 生成したファイルパス
 */
export function makeChatFilePath(dirPath: string): string {
  const timestamp = timestampAsString();

  return path.join(dirPath, `Promptis_${timestamp}.md`);
}
