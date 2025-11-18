import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * @interface
 * 拡張されたチャットレスポンスストリーム。ファイルに書き込む機能を追加している
 */
interface FileChatResponseStream extends vscode.ChatResponseStream {
  writeToFile(filePath: string): void;
}

/**
 * 拡張されたファイルチャットレスポンスストリームの実装。
 * コンストラクタで指定されたファイルに対し、ChatResponseStream に書き込まれた内容を書き込む
 *
 */
export class FileChatResponseStreamWrapper implements FileChatResponseStream {
  private originalStream: vscode.ChatResponseStream;
  private content: string[] = [];
  private filePath: string;

  /**
   * コンストラクタ。
   * @param {vscode.ChatResponseStream} originalStream - 元のチャットレスポンスストリーム
   * @param {string} filePath - コンテンツの保存先ファイルパス
   */
  constructor(originalStream: vscode.ChatResponseStream, filePath: string) {
    this.originalStream = originalStream;
    this.filePath = filePath;
  }

  anchor(value: vscode.Uri | vscode.Location, title?: string): void {
    this.originalStream.anchor(value, title);
  }
  button(command: vscode.Command): void {
    this.originalStream.button(command);
  }
  filetree(value: vscode.ChatResponseFileTree[], baseUri: vscode.Uri): void {
    this.originalStream.filetree(value, baseUri);
  }
  progress(value: string): void {
    this.originalStream.progress(value);
  }
  reference(
    value: vscode.Uri | vscode.Location,
    iconPath?: vscode.Uri | vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri },
  ): void {
    this.originalStream.reference(value, iconPath);
  }
  push(part: vscode.ChatResponsePart): void {
    this.originalStream.push(part);
  }

  /**
   * Markdown形式のテキストを保存対象に追加し、元のストリームにも書き出す
   * @param {string} text - Markdown形式のテキスト
   */
  markdown(text: string): void {
    this.content.push(text);
    this.originalStream.markdown(text);
  }

  /**
   * ChatWindow非経由でファイルに直接書き込み
   * content配列にのみ蓄積し、originalStream.markdown()は呼び出さない
   * @param {string} text - 書き込み対象のテキスト
   */
  writeDirectToFile(text: string): void {
    this.content.push(text);
  }

  /**
   * 保存用に累積したコンテンツをファイルに追記する
   * 複数回呼び出すことで、全ての処理結果を1つのファイルに蓄積できる
   */
  writeToFile(): void {
    try {
      // ファイルパスを絶対パスに変換
      const fullPath = path.resolve(this.filePath);
      // コンテンツをファイルに追記（複数回の処理結果を全て保存）
      fs.appendFileSync(fullPath, this.content.join(""), "utf8");
      // メモリリークを防ぐために書き込み後にコンテンツをクリア
      this.clearContent();
    } catch (error) {
      console.error("Failed to write file:", error);
      vscode.window.showErrorMessage("Failed to write file: " + error);
      throw error;
    }
  }

  /**
   * 累積したコンテンツをクリアする
   */
  clearContent(): void {
    this.content = [];
  }

  /**
   * リソースを解放する
   */
  dispose(): void {
    this.clearContent();
  }
}
