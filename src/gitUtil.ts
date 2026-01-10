import path from "path";
import * as vscode from "vscode";

/**
 * Git差分結果を表すインターフェース
 */
export interface DiffResult {
  filePath: string;        // 絶対パス
  relativePath: string;    // ワークスペースからの相対パス
  diff: string;            // unified diff コンテンツ
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;        // リネームされたファイルの旧パス
  fileExtension: string;   // 例: ".ts", ".sql", ".tf"
}

/**
 * Git範囲指定を表すインターフェース
 */
export interface GitRange {
  base: string;            // 例: "origin/main"
  compare: string;         // 例: "HEAD"
}

/**
 * VS Code Git Extension の型定義
 */
interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
}

interface Repository {
  rootUri: vscode.Uri;
  diff(cached?: boolean): Promise<string>;
  diffWith(ref: string): Promise<string>;
  diffBetween(ref1: string, ref2: string): Promise<string>;
  getBranch(name: string): Promise<Branch | undefined>;
  state: {
    HEAD: Ref | undefined;
    refs: Ref[];
  };
}

interface Branch {
  name?: string;
  commit?: string;
  type: number;
}

interface Ref {
  type: number;
  name?: string;
  commit?: string;
  remote?: string;
}

/**
 * VS Code Git拡張機能を取得
 * @returns GitExtension または undefined
 */
export function getGitExtension(): GitExtension | undefined {
  try {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      console.error('Git extension not found');
      return undefined;
    }

    if (!extension.isActive) {
      console.log('Git extension is not active yet');
    }

    return extension.exports;
  } catch (error) {
    console.error('Failed to get Git extension:', error);
    return undefined;
  }
}

/**
 * ワークスペースからGitリポジトリを取得
 * @param workspaceUri - ワークスペースURI（省略時は最初のワークスペース）
 * @returns Repository または undefined
 */
export function getRepository(workspaceUri?: vscode.Uri): Repository | undefined {
  const gitExtension = getGitExtension();
  if (!gitExtension) {
    return undefined;
  }

  const git = gitExtension.getAPI(1);
  if (!git) {
    console.error('Failed to get Git API');
    return undefined;
  }

  // ワークスペースURIが指定されていない場合は、最初のワークスペースフォルダーを使用
  const targetUri = workspaceUri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!targetUri) {
    console.error('No workspace folder found');
    return undefined;
  }

  // リポジトリを取得
  const repo = git.getRepository(targetUri);
  if (!repo) {
    // リポジトリが見つからない場合、最初のリポジトリを返す（フォールバック）
    if (git.repositories.length > 0) {
      return git.repositories[0];
    }
    console.error('No Git repository found');
    return undefined;
  }

  return repo;
}

/**
 * Git範囲指定文字列をパース
 * 構文: "base...compare" または "base..compare"
 * @param rangeSpec - 範囲指定文字列（例: "origin/main...HEAD"）
 * @param defaultBase - デフォルトのベースブランチ（省略時は "origin/main"）
 * @returns GitRange
 */
export function parseGitRange(rangeSpec?: string, defaultBase: string = "origin/main"): GitRange {
  if (!rangeSpec) {
    // 範囲指定なし → デフォルト
    return {
      base: defaultBase,
      compare: "HEAD"
    };
  }

  // "..." または ".." で分割
  const tripleMatch = rangeSpec.match(/^(.+)\.\.\.(.+)$/);
  if (tripleMatch) {
    return {
      base: tripleMatch[1],
      compare: tripleMatch[2]
    };
  }

  const doubleMatch = rangeSpec.match(/^(.+)\.\.(.+)$/);
  if (doubleMatch) {
    return {
      base: doubleMatch[1],
      compare: doubleMatch[2]
    };
  }

  // パースできない場合はエラーをスロー
  throw new Error(
    `Invalid Git range format: "${rangeSpec}". ` +
    `Expected format: "base...compare" (e.g., "origin/main...HEAD")`
  );
}

/**
 * デフォルトのベースブランチを決定
 * @param repo - Gitリポジトリ
 * @returns ベースブランチ名（例: "origin/main" または "origin/master"）
 */
export async function getDefaultBaseBranch(repo: Repository): Promise<string> {
  try {
    // まず origin/main を試す
    const mainBranch = await repo.getBranch("origin/main");
    if (mainBranch) {
      return "origin/main";
    }

    // 次に origin/master を試す
    const masterBranch = await repo.getBranch("origin/master");
    if (masterBranch) {
      return "origin/master";
    }

    // どちらも見つからない場合はデフォルト
    return "origin/main";
  } catch (error) {
    console.warn('Failed to determine default base branch, using "origin/main":', error);
    return "origin/main";
  }
}

/**
 * Git APIを使用して差分を取得
 * @param repo - Gitリポジトリ
 * @param range - Git範囲指定
 * @returns DiffResult の配列
 */
export async function getDiffContent(repo: Repository, range: GitRange): Promise<DiffResult[]> {
  try {
    // diffBetween を使用して差分を取得
    const diffOutput = await repo.diffBetween(range.base, range.compare);

    if (!diffOutput || diffOutput.trim().length === 0) {
      return [];
    }

    // unified diff をパース
    return parseDiffOutput(diffOutput, repo.rootUri.fsPath);
  } catch (error) {
    console.error('Failed to get diff content:', error);
    throw new Error(
      `Failed to get diff between ${range.base} and ${range.compare}. ` +
      `Please ensure both refs exist. Error: ${error}`
    );
  }
}

/**
 * unified diff 出力をパースして DiffResult 配列に変換
 * @param diffOutput - Git diff の unified 形式出力
 * @param repoRoot - リポジトリルートの絶対パス
 * @returns DiffResult の配列
 */
export function parseDiffOutput(diffOutput: string, repoRoot: string): DiffResult[] {
  const results: DiffResult[] = [];

  // diff を各ファイルごとに分割
  // "diff --git" で始まる行でファイルを区切る
  const fileDiffs = diffOutput.split(/^diff --git /m).slice(1);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');

    // 最初の行から a/path b/path を抽出
    const firstLine = lines[0];
    const pathMatch = firstLine.match(/a\/(.+?)\s+b\/(.+?)$/);
    if (!pathMatch) {
      continue;
    }

    const aPath = pathMatch[1];
    const bPath = pathMatch[2];

    // 変更タイプを判定
    let changeType: DiffResult['changeType'] = 'modified';
    let oldPath: string | undefined;
    let currentPath = bPath;

    // new file, deleted file, rename などを検出
    for (const line of lines) {
      if (line.startsWith('new file mode')) {
        changeType = 'added';
      } else if (line.startsWith('deleted file mode')) {
        changeType = 'deleted';
        currentPath = aPath;
      } else if (line.startsWith('rename from')) {
        changeType = 'renamed';
        oldPath = aPath;
      }
    }

    // バイナリファイルをスキップ
    if (fileDiff.includes('Binary files')) {
      console.log(`Skipping binary file: ${currentPath}`);
      continue;
    }

    // 絶対パスと相対パスを構築
    const absolutePath = path.join(repoRoot, currentPath);
    const relativePath = currentPath;

    // ファイル拡張子を取得
    const fileExtension = path.extname(currentPath);

    // unified diff コンテンツを再構築（"diff --git" 行を含める）
    const diffContent = `diff --git ${firstLine}\n${lines.slice(1).join('\n')}`;

    results.push({
      filePath: absolutePath,
      relativePath,
      diff: diffContent,
      changeType,
      oldPath: oldPath ? path.join(repoRoot, oldPath) : undefined,
      fileExtension
    });
  }

  return results;
}
