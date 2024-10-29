import fs from "fs";
import { minimatch } from "minimatch";
import path from "path";
import * as vscode from "vscode";

/**
 * 指定したディレクトリ内のファイルを再帰的に取得する関数
 *
 * @param {string} directoryPath - ファイル一覧を取得するディレクトリのパス
 * @returns {fs.Dirent[]} - ディレクトリ内のファイルエントリの配列
 *
 * @example
 * const files = getFilesInDirectory('/path/to/directory');
 *
 * @throws {Error} - ディレクトリの読み取りに失敗した場合
 */
function getFilesInDirectory(directoryPath: string): fs.Dirent[] {
  try {
    const entries = fs.readdirSync(directoryPath, {
      withFileTypes: true,
      recursive: true,
    });

    // ディレクトリ内の全エントリの中からファイルのみを返す;
    return entries.filter((entry) => entry.isFile());
  } catch (error) {
    console.error("Failed to read directory:", error);
    vscode.window.showErrorMessage("Failed to read directory: " + error);
    return [];
  }
}

/**
 * 指定されたディレクトリ配下にある、拡張子が.mdのファイルを抽出し、指定されたignoreパターンにマッチしないファイルを返す関数。
 *
 * @param {string} directoryPath - ファイル一覧を取得するディレクトリのパス
 * @param {string[]} ignorePatterns - 無視するファイルパターンの配列
 * @returns {string[]} - .mdファイルのパスの配列（ignoreパターンにマッチしないもの）
 *
 * @example
 * const promptFiles = findPromptFiles('/path/to/directory', ['node_modules/**', '*.test.md']);
 * console.log(promptFiles);
 */
export function findPromptFiles(directoryPath: string, ignorePatterns: string[]): string[] {
  const files = getFilesInDirectory(directoryPath);

  console.log(`Found ${files.length} files in ${directoryPath}`);
  console.log("Ignore patterns:", JSON.stringify(ignorePatterns));
  // .mdファイル、かつ ignore パターンにマッチしないファイルを抽出する
  const promptFiles = files
    // プロンプトファイルの拡張子は.mdとする
    .filter((file) => file.name.endsWith(".md"))
    .map((file) => path.join(file.parentPath, file.name))
    // ignorePatternsにマッチしないファイルのみを残す
    .filter((p) => ignorePatterns.every((pattern) => !minimatch(p, pattern)));

  return promptFiles;
}

export function extractTargetFiles(req: vscode.ChatRequest): string[] {
  // references は出現順の逆順になるため、末尾から処理する
  const ret: string[] = [];
  for (let i = req.references.length - 1; i >= 0; i--) {
    const ref = req.references[i];

    // チャットの中で #file: として指定された時の request.references の例
    //   Linuxの場合:   {"id":"vscode.file","name":"file:.bashrc","range":[12,25],"value":{"$mid":1,"path":"/home/node/.bashrc","scheme":"file"}}]
    //   Windowsの場合: {"id":"vscode.file","name":"file:util.ts","range":[0,13], "value":{"$mid":1,"fsPath":"c:\\path\\to\\util.ts","_sep":1,"external":"file:///path/to/util.ts","path":"/c:/path/to/util.ts","scheme":"file"}}
    // value は型としては unknown だが、実体は vscode.Uri 型になっている

    // referenceがファイルの場合、当該ファイルの内容を返す
    if (ref.id === "vscode.file") {
      const uri = ref.value as vscode.Uri;
      // 基本的にはfsPathを使うべき。ただし、Linuxの場合はfsPathが渡されないため、pathを使う
      ret.push(uri.fsPath ?? uri.path);
    }
  }
  return ret;
}

/**
 * タイムスタンプをYYYYMMDD-HHmmss形式の文字列で返す関数。
 * 
 * @param {Date} date - タイムスタンプを取得する日時。省略した場合は現在時刻を使用する。
 * @returns {string} - YYYYMMDD-HHmmss形式の文字列
 */
export function timestampAsString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}