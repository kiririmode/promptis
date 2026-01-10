import path from "path";
import * as vscode from "vscode";
import { getDiffContent, getRepository, parseGitRange, type GitRange } from "../gitUtil";
import { filterPromptsByTarget, type PromptMetadata } from "../util";
import { FileReviewPhase } from "../review/FileReviewPhase";
import { ChangesetReviewPhase } from "../review/ChangesetReviewPhase";
import type { PromptMetadataWithScope } from "../review/types";
import type { ReviewCommandHandler } from "./CommandRouter";

/**
 * 差分レビューコマンドハンドラー
 * Phase 2: 二段パイプライン（file/changeset）対応
 */
export class DiffReviewCommandHandler implements ReviewCommandHandler {
  private fileReviewPhase: FileReviewPhase;
  private changesetReviewPhase: ChangesetReviewPhase;

  constructor() {
    this.fileReviewPhase = new FileReviewPhase();
    this.changesetReviewPhase = new ChangesetReviewPhase();
  }
  /**
   * 差分レビューを実行（二段パイプライン）
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
    // 1. Gitリポジトリを取得
    const repo = getRepository();
    if (!repo) {
      stream.markdown("⚠️ Gitリポジトリが見つかりません。Gitリポジトリ内で実行してください。\n");
      return { errorDetails: { message: "No Git repository found" } };
    }

    // 2. 差分範囲を取得
    const range = await this.extractDiffRange(request, repo);
    if (!range) {
      stream.markdown("⚠️ 差分範囲を特定できません。\n");
      return { errorDetails: { message: "Failed to determine diff range" } };
    }

    stream.markdown(`📊 **差分レビュー**: \`${range.base}...${range.compare}\`\n\n`);

    // 3. 差分を取得
    let diffResults;
    try {
      diffResults = await getDiffContent(repo, range);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stream.markdown(`❌ 差分取得エラー: ${errorMessage}\n`);
      return { errorDetails: { message: errorMessage } };
    }

    if (diffResults.length === 0) {
      stream.markdown(`ℹ️ \`${range.base}..${range.compare}\` 間に変更がありません。\n`);
      return;
    }

    stream.markdown(`変更されたファイル: **${diffResults.length}** 件\n\n`);

    // ワークスペースルートを取得
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    // プロンプトメタデータを PromptMetadataWithScope として扱う
    // parsePromptFile が scope フィールドを含むため、キャスト可能
    const promptMetadataWithScope = promptMetadata as PromptMetadataWithScope[];

    // 4. Phase 1: ファイル単位レビュー (scope: file)
    stream.markdown(`## ファイル単位レビュー\n\n`);
    const fileResults = await this.fileReviewPhase.execute(
      diffResults,
      promptMetadataWithScope,
      request.model,
      token,
      stream,
      workspaceRoot
    );

    // 5. Phase 2: 変更集合レビュー (scope: changeset)
    await this.changesetReviewPhase.execute(
      diffResults,
      fileResults,
      promptMetadataWithScope,
      request.model,
      token,
      stream,
      workspaceRoot
    );

    // サマリーを出力
    stream.markdown(`## レビュー完了\n\n`);
    stream.markdown(`- ファイル単位レビュー: **${fileResults.length}** ファイル\n`);
    stream.markdown(`- 変更集合レビュー: 実行完了\n`);
  }

  /**
   * チャットリクエストから差分範囲指定を抽出
   * @param request - チャットリクエスト
   * @param repo - Gitリポジトリ
   * @returns GitRange または undefined
   */
  private async extractDiffRange(
    request: vscode.ChatRequest,
    repo: any
  ): Promise<GitRange | undefined> {
    // プロンプトから #range:spec を抽出
    const rangeMatch = request.prompt.match(/#range:(\S+)/);

    if (rangeMatch) {
      const rangeSpec = rangeMatch[1];
      try {
        return parseGitRange(rangeSpec);
      } catch (error) {
        console.error('Failed to parse range spec:', error);
        return undefined;
      }
    }

    // #range 指定なし → デフォルトを使用（origin/main...HEAD）
    try {
      const { getDefaultBaseBranch } = await import('../gitUtil.js');
      const defaultBase = await getDefaultBaseBranch(repo);
      return parseGitRange(undefined, defaultBase);
    } catch (error) {
      console.error('Failed to get default base branch:', error);
      return undefined;
    }
  }

}
