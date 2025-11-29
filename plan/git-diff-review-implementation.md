# Git Diff Review 機能実装計画

## 概要

Issue #112に対応し、ファイル全体ではなくGit diffの変更箇所のみをレビューする機能をPromptiśに追加します。

## ユーザー要件（確認済み）

- **コマンド形式**: 新規専用コマンド `/codereviewDiff`
- **差分範囲**: デフォルトは`main...HEAD`だが、ユーザーが指定可能（例: `main...feature-branch`, `HEAD~3..HEAD`）
- **フォーマット**: Unified diff形式でLLMに送信
- **UI**: チャットコマンドのみ（右クリックメニューは実装しない）

## アーキテクチャ概要

### 現在のアーキテクチャ（調査済み）

```
chatHandler (src/chatHandler.ts)
  ↓
extractTargetFiles (src/util.ts) - #file, #dir, #filter変数を処理
  ↓
processSourceFiles - 各ファイルを処理
  ↓
processContent - 各プロンプトをLLMに送信
  ↓
OutputStrategy - 結果をチャットまたはファイルに出力
```

### 新規アーキテクチャ

```
chatHandler
  ↓ (command === "codereviewDiff")
extractDiffRange (src/util.ts) - #range変数を解析
  ↓
getRepository (src/gitUtil.ts) - Gitリポジトリを取得
  ↓
getDiffContent (src/gitUtil.ts) - 差分を取得
  ↓
processDiffFiles (src/diffProcessor.ts) - 各差分を処理
  ↓
processContent - 既存のLLM送信ロジックを再利用
  ↓
OutputStrategy - 既存の出力戦略を再利用
```

## 設計決定

1. **VS Code Git Extension APIを使用**: `git`コマンドをspawnするのではなく、公式APIを使用
2. **Unified Diff形式**: LLMが理解しやすい標準フォーマット
3. **柔軟な差分範囲指定**: `#range:base...compare`構文でGit参照を指定可能
4. **既存コードの再利用**: `processContent()`と`OutputStrategy`を再利用

## 実装ステップ

### Step 1: Gitユーティリティモジュールの作成

**ファイル**: `src/gitUtil.ts` (新規作成)

**実装内容**:

```typescript
import * as vscode from 'vscode';

export interface DiffResult {
  filePath: string;           // ファイルの絶対パス
  relativePath: string;       // ワークスペースからの相対パス
  diff: string;               // Unified diff形式の差分
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;           // リネームの場合の旧パス
}

export interface GitExtension {
  // VS Code Git Extension API型定義
  getAPI(version: number): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
}

export interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
  diff(cached?: boolean): Promise<string>;
  diffWith(ref: string, path?: string): Promise<string>;
  diffBetween(ref1: string, ref2: string, path?: string): Promise<string>;
  getBranch(name: string): Promise<Branch>;
}

/**
 * VS Code Git拡張機能を取得
 */
export function getGitExtension(): GitExtension | undefined {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    return undefined;
  }
  return extension.isActive ? extension.exports : undefined;
}

/**
 * ワークスペースのGitリポジトリを取得
 */
export function getRepository(workspaceFolder?: vscode.Uri): Repository | undefined {
  const gitExtension = getGitExtension();
  if (!gitExtension) {
    return undefined;
  }

  const api = gitExtension.getAPI(1);
  if (!api || api.repositories.length === 0) {
    return undefined;
  }

  if (workspaceFolder) {
    return api.getRepository(workspaceFolder) ?? undefined;
  }

  // デフォルトは最初のリポジトリ
  return api.repositories[0];
}

/**
 * デフォルトのベースブランチを検出
 */
export async function getDefaultBaseBranch(repo: Repository): Promise<string> {
  // 設定から取得
  const configuredBase = vscode.workspace.getConfiguration('promptis')
    .get<string>('git.defaultBaseBranch');

  if (configuredBase) {
    return configuredBase;
  }

  // mainまたはmasterが存在するかチェック
  try {
    await repo.getBranch('main');
    return 'main';
  } catch {
    try {
      await repo.getBranch('master');
      return 'master';
    } catch {
      return 'main'; // デフォルトフォールバック
    }
  }
}

/**
 * Git範囲指定文字列を解析
 * 例: "main...HEAD" → {base: "main", compare: "HEAD"}
 */
export function parseGitRange(rangeSpec?: string, defaultBase?: string): {base: string, compare: string} {
  if (!rangeSpec) {
    return {
      base: defaultBase || 'main',
      compare: 'HEAD'
    };
  }

  // "base...compare" または "base..compare" 形式をサポート
  const tripleDotsMatch = rangeSpec.match(/^(.+?)\.\.\.(.+)$/);
  if (tripleDotsMatch) {
    return {base: tripleDotsMatch[1], compare: tripleDotsMatch[2]};
  }

  const doubleDotsMatch = rangeSpec.match(/^(.+?)\.\.(.+)$/);
  if (doubleDotsMatch) {
    return {base: doubleDotsMatch[1], compare: doubleDotsMatch[2]};
  }

  // 範囲指定なしの場合は単一のrefとして扱い、baseとの比較とする
  return {
    base: defaultBase || 'main',
    compare: rangeSpec
  };
}

/**
 * 2つのGit参照間の差分を取得
 */
export async function getDiffContent(
  repo: Repository,
  base: string,
  compare: string
): Promise<DiffResult[]> {
  try {
    // リポジトリ全体の差分を取得
    const diffOutput = await repo.diffBetween(base, compare);

    // 差分を解析してファイルごとに分割
    return parseDiffOutput(diffOutput, repo.rootUri);
  } catch (error) {
    throw new Error(`Failed to get diff between ${base} and ${compare}: ${error}`);
  }
}

/**
 * Unified diff出力を解析してファイルごとのDiffResultに変換
 */
function parseDiffOutput(diffOutput: string, repoRoot: vscode.Uri): DiffResult[] {
  const results: DiffResult[] = [];

  // diff --git a/file b/file で分割
  const fileDiffs = diffOutput.split(/^diff --git /m).slice(1);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');
    const header = lines[0];

    // a/path b/path を抽出
    const pathMatch = header.match(/a\/(.+?) b\/(.+)/);
    if (!pathMatch) continue;

    const oldPath = pathMatch[1];
    const newPath = pathMatch[2];

    // 変更タイプを判定
    let changeType: DiffResult['changeType'] = 'modified';
    if (fileDiff.includes('new file mode')) {
      changeType = 'added';
    } else if (fileDiff.includes('deleted file mode')) {
      changeType = 'deleted';
    } else if (oldPath !== newPath) {
      changeType = 'renamed';
    }

    const absolutePath = vscode.Uri.joinPath(repoRoot, newPath).fsPath;

    results.push({
      filePath: absolutePath,
      relativePath: newPath,
      diff: 'diff --git ' + fileDiff, // 元のdiffヘッダーを含める
      changeType,
      oldPath: oldPath !== newPath ? oldPath : undefined
    });
  }

  return results;
}
```

**エラーハンドリング**:
- Git拡張が無効: エラーメッセージを表示
- リポジトリが見つからない: エラーメッセージを表示
- 無効なGit範囲: 適切なフォーマットを提案

---

### Step 2: ユーティリティ関数の追加

**ファイル**: `src/util.ts` (既存ファイルに追加)

**実装内容**:

```typescript
/**
 * チャットリクエストから差分範囲を抽出
 * 例: "#range:main...HEAD" → {base: "main", compare: "HEAD"}
 */
export async function extractDiffRange(
  request: vscode.ChatRequest
): Promise<{ base: string; compare: string } | undefined> {
  const rangeMatch = request.prompt.match(/#range:(\S+)/);

  if (rangeMatch) {
    const rangeSpec = rangeMatch[1];
    return parseGitRange(rangeSpec);
  }

  // 範囲指定がない場合はデフォルトを使用
  const repo = getRepository();
  if (!repo) {
    return undefined;
  }

  const defaultBase = await getDefaultBaseBranch(repo);
  return parseGitRange(undefined, defaultBase);
}
```

**インポート追加**:
```typescript
import { getRepository, parseGitRange, getDefaultBaseBranch } from './gitUtil';
```

---

### Step 3: Diff処理モジュールの作成

**ファイル**: `src/diffProcessor.ts` (新規作成)

**実装内容**:

```typescript
import * as vscode from 'vscode';
import { DiffResult } from './gitUtil';
import { PromptMetadata, filterPromptsByTarget } from './util';
import { OutputStrategy } from './output/outputStrategy';

/**
 * Git差分ファイルを処理し、プロンプトを適用してレビュー
 */
export async function processDiffFiles(
  diffResults: DiffResult[],
  promptMetadata: PromptMetadata[],
  stream: vscode.ChatResponseStream,
  request: vscode.ChatRequest,
  token: vscode.CancellationToken,
  outputStrategy: OutputStrategy
): Promise<void> {
  for (const diffResult of diffResults) {
    if (token.isCancellationRequested) {
      break;
    }

    // バイナリファイルやdiffが空の場合はスキップ
    if (!diffResult.diff || diffResult.diff.trim().length === 0) {
      continue;
    }

    // このファイルに適用可能なプロンプトをフィルタリング
    const applicablePrompts = filterPromptsByTarget(
      promptMetadata,
      diffResult.relativePath
    );

    if (applicablePrompts.length === 0) {
      continue;
    }

    // 各プロンプトを適用
    for (const prompt of applicablePrompts) {
      if (token.isCancellationRequested) {
        break;
      }

      await processDiffWithPrompt(
        diffResult,
        prompt,
        stream,
        request,
        token,
        outputStrategy
      );
    }
  }
}

/**
 * 1つの差分ファイルに1つのプロンプトを適用
 */
async function processDiffWithPrompt(
  diffResult: DiffResult,
  prompt: PromptMetadata,
  stream: vscode.ChatResponseStream,
  request: vscode.ChatRequest,
  token: vscode.CancellationToken,
  outputStrategy: OutputStrategy
): Promise<void> {
  // LLMに送信するコンテンツを構築
  const content = formatDiffForLLM(diffResult, prompt);

  // 既存のprocessContent関数を再利用
  // (chatHandler.tsから抽出する必要がある)
  await processContent(
    content,
    diffResult.relativePath,
    prompt,
    stream,
    request,
    token,
    outputStrategy
  );
}

/**
 * Diff結果をLLMが理解しやすい形式にフォーマット
 */
function formatDiffForLLM(diffResult: DiffResult, prompt: PromptMetadata): string {
  const changeTypeLabel = {
    added: '新規追加',
    modified: '変更',
    deleted: '削除',
    renamed: 'リネーム'
  };

  let content = `# ファイル: ${diffResult.relativePath}\n`;
  content += `## 変更タイプ: ${changeTypeLabel[diffResult.changeType]}\n\n`;

  if (diffResult.oldPath && diffResult.changeType === 'renamed') {
    content += `旧パス: ${diffResult.oldPath}\n\n`;
  }

  content += `## 差分内容:\n\n`;
  content += '```diff\n';
  content += diffResult.diff;
  content += '\n```\n\n';

  content += `## レビュー観点:\n\n`;
  content += prompt.content;

  return content;
}

// processContent関数をchatHandler.tsから抽出して共有モジュールに移動する必要がある
// または、chatHandler.tsからエクスポートして使用する
```

**注意**: `processContent`関数は現在`chatHandler.ts`にprivate関数として存在しているため、これを共有可能にする必要があります。

---

### Step 4: チャットハンドラーの更新

**ファイル**: `src/chatHandler.ts` (既存ファイルを修正)

**変更点**:

1. **インポート追加**:
```typescript
import { getRepository, getDiffContent } from './gitUtil';
import { extractDiffRange } from './util';
import { processDiffFiles } from './diffProcessor';
```

2. **コマンドマッピング追加** (37行目付近):
```typescript
const commandPromptDirectoryMap: CommandPromptPathMap = new Map([
  ["codereviewCodeStandards", Config.getCodeReviewCodeStandardPath],
  ["codereviewFunctional", Config.getCodeReviewFunctionalPath],
  ["codereviewNonFunctional", Config.getCodeReviewNonFunctionalPath],
  ["reverseEngineering", Config.getReverseEngineeringPromptsPath],
  ["drawDiagrams", Config.getDrawDiagramsPromptsPath],
  ["codereviewDiff", Config.getCodeReviewDiffPath], // 新規追加
]);
```

3. **ハンドラーロジック更新** (74-82行目付近):
```typescript
// 既存: const targetFiles = await extractTargetFiles(request, stream);

// 新規: Diffコマンドの処理を追加
if (command === "codereviewDiff") {
  // Git差分レビューモード
  const repo = getRepository();

  if (!repo) {
    stream.markdown("⚠️ Gitリポジトリが見つかりません。このワークスペースはGit管理されていますか？");
    return;
  }

  const diffRange = await extractDiffRange(request);

  if (!diffRange) {
    stream.markdown("⚠️ 差分範囲の取得に失敗しました。");
    return;
  }

  try {
    const diffResults = await getDiffContent(repo, diffRange.base, diffRange.compare);

    if (diffResults.length === 0) {
      stream.markdown(`ℹ️ \`${diffRange.base}\`と\`${diffRange.compare}\`の間に変更が見つかりませんでした。`);
      return;
    }

    stream.markdown(`📊 **${diffResults.length}個のファイルの差分をレビューします** (\`${diffRange.base}...${diffRange.compare}\`)\n\n`);

    await processDiffFiles(
      diffResults,
      promptMetadata,
      stream,
      request,
      token,
      outputStrategy
    );
  } catch (error) {
    stream.markdown(`❌ エラー: ${error instanceof Error ? error.message : String(error)}\n\n`);
    stream.markdown(`💡 ヒント: Git範囲の指定は \`#range:main...HEAD\` のような形式で行えます。`);
    return;
  }
} else {
  // 既存のファイルベース処理
  const targetFiles = await extractTargetFiles(request, stream);
  // ... 既存のロジック
}
```

4. **processContent関数をエクスポート** (211行目付近):
```typescript
// private関数をexportに変更
export async function processContent(
  content: string,
  // ... 既存のパラメータ
) {
  // ... 既存の実装
}
```

---

### Step 5: 設定の追加

**ファイル**: `src/config.ts` (既存ファイルに追加)

**追加メソッド**:
```typescript
export class Config {
  // ... 既存のメソッド

  /**
   * Git差分レビュー用プロンプトディレクトリのパスを取得
   */
  static getCodeReviewDiffPath(): string | undefined {
    return vscode.workspace
      .getConfiguration("promptis")
      .get<string>("codeReview.diffPath");
  }

  /**
   * デフォルトのベースブランチを取得
   */
  static getDefaultBaseBranch(): string {
    return vscode.workspace
      .getConfiguration("promptis")
      .get<string>("git.defaultBaseBranch", "main");
  }
}
```

**ファイル**: `package.json` (設定スキーマ追加)

**configuration セクションに追加**:
```json
{
  "promptis.codeReview.diffPath": {
    "type": "string",
    "description": "Git差分レビュー用のプロンプトファイルが格納されているディレクトリのパス"
  },
  "promptis.git.defaultBaseBranch": {
    "type": "string",
    "default": "main",
    "description": "差分比較時のデフォルトベースブランチ（例: main, master, develop）",
    "enum": ["main", "master", "develop"]
  }
}
```

---

### Step 6: package.jsonの更新

**activationEvents に追加**:
```json
"activationEvents": [
  "onLanguage:*",
  "onView:scm"
]
```

**extensionDependencies** (必要に応じて):
```json
"extensionDependencies": [
  "vscode.git"
]
```

---

## テスト戦略

### ユニットテスト

**ファイル**: `src/test/gitUtil.test.ts` (新規作成)

**テストケース**:
- ✅ `parseGitRange()` - 正しく範囲を解析
- ✅ `getDefaultBaseBranch()` - デフォルトブランチ検出
- ✅ `parseDiffOutput()` - Unified diff解析
- ✅ エラーハンドリング（Git拡張なし、リポジトリなし）

**ファイル**: `src/test/diffProcessor.test.ts` (新規作成)

**テストケース**:
- ✅ `formatDiffForLLM()` - 正しくフォーマット
- ✅ `processDiffFiles()` - 複数ファイル処理
- ✅ プロンプトフィルタリング

### 手動テストチェックリスト

- [ ] `/codereviewDiff` でデフォルト範囲（main...HEAD）を使用
- [ ] `/codereviewDiff #range:main...feature-branch` で範囲指定
- [ ] `/codereviewDiff #range:HEAD~3..HEAD` で相対範囲指定
- [ ] Gitリポジトリがない場合のエラーメッセージ
- [ ] 無効なGit範囲のエラーメッセージ
- [ ] 複数ファイルの変更が正しく処理される
- [ ] 出力がバックアップディレクトリに保存される（設定時）
- [ ] プロンプトのapplyToフィルタが正しく動作

---

## 実装前に読むべき重要ファイル

1. **src/chatHandler.ts** (37-283行)
   - コマンド処理フロー
   - `processSourceFiles()`と`processContent()`のパターン

2. **src/util.ts** (200-350行)
   - `extractTargetFiles()`の実装
   - チャット変数解析パターン

3. **src/config.ts** (全体)
   - 設定パターン

4. **package.json** (configuration, activationEvents)
   - 既存のコマンド構造と設定スキーマ

5. **@types/vscode** (Git API型定義)
   - `GitExtension`, `Repository`インターフェース

---

## エッジケースと対策

| エッジケース | 対策 |
|------------|------|
| Gitリポジトリなし | 早期チェック、明確なエラーメッセージ表示 |
| 無効なGit範囲 | パース時に検証、正しいフォーマット提案 |
| バイナリファイルの変更 | スキップして情報メッセージ表示 |
| 非常に大きな差分 | 初期実装では制限なし（将来的にチャンキング検討） |
| マージコンフリクト | そのまま表示、LLMに分析させる |
| Git拡張が無効 | 利用可能性チェック、有効化を促すメッセージ |
| 差分なし | 情報メッセージを表示してグレースフル終了 |
| リネームされたファイル | 新旧両方のパスをコンテキストに含める |

---

## 潜在的リスク

1. **パフォーマンス**: 大きな差分は多くのトークンを消費
   - *対策*: シンプルに開始、必要に応じて将来チャンキング追加

2. **Git API互換性**: VS Code Git APIが変更される可能性
   - *対策*: 安定したAPIサーフェスを使用、必要に応じてバージョンチェック

3. **ユーザー混乱**: Git範囲構文に不慣れなユーザー
   - *対策*: エラーメッセージとドキュメントに明確な例を提供

4. **トークン消費**: Unified diffにはコンテキスト行が含まれる
   - *対策*: ユーザー選択により許容可能、将来的に設定オプション検討

---

## 実装順序

1. ✅ `src/gitUtil.ts` 作成 - Git統合機能
2. ✅ `src/test/gitUtil.test.ts` 作成 - ユニットテスト
3. ✅ `src/config.ts` 更新 - 新設定メソッド
4. ✅ `src/diffProcessor.ts` 作成 - Diff処理ロジック
5. ✅ `src/util.ts` 更新 - `extractDiffRange()`追加
6. ✅ `src/chatHandler.ts` 更新 - `/codereviewDiff`コマンド処理
7. ✅ `package.json` 更新 - 設定とアクティベーションイベント
8. ✅ `src/test/diffProcessor.test.ts` 作成 - 統合テスト
9. ✅ 手動テストと検証
10. ✅ ドキュメント更新（README、使用例）

---

## フェーズ1以降の拡張機能（スコープ外）

- 右クリックメニュー統合（diff viewから）
- Staged vs Unstaged変更サポート（#staged, #unstaged）
- Diff viewへのレビュー結果デコレーション
- インラインコメント付きインタラクティブレビュー
- 特定ファイルのみの差分サポート
- 簡略化された差分フォーマットオプション（変更行のみ）
