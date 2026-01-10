import type { PromptMetadata } from "../util";
import type { DiffResult } from "../gitUtil";

/**
 * プロンプトのスコープ
 * - file: ファイル単位のレビュー（個別ファイルに対して実行）
 * - changeset: 変更集合全体のレビュー（全体の整合性チェック）
 */
export type PromptScope = 'file' | 'changeset';

/**
 * スコープ情報を含む拡張プロンプトメタデータ
 */
export interface PromptMetadataWithScope extends PromptMetadata {
  /**
   * プロンプトのスコープ（デフォルト: 'file'）
   */
  scope: PromptScope;
}

/**
 * ファイル単位レビューの結果
 */
export interface FileReviewResult {
  /**
   * レビュー対象ファイルの絶対パス
   */
  filePath: string;

  /**
   * ワークスペースルートからの相対パス
   */
  relativePath: string;

  /**
   * ファイル拡張子（例: ".ts", ".sql", ".tf"）
   */
  fileExtension: string;

  /**
   * Unified diff形式の差分内容
   */
  diff: string;

  /**
   * LLMによるレビュー本文
   */
  reviewText: string;
}
