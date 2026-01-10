# 実装計画: `/codereviewDiff` コマンド

## 概要

ファイル全体ではなくGit差分（ハンク）のみをレビューする新しい `/codereviewDiff` コマンドを追加します（GitHub issue #112 対応）。

**主要機能:**
- ファイル全体ではなくGit差分（unified形式）をレビュー
- デフォルト: `origin/main...HEAD` の差分を比較
- `#range:` 構文でカスタマイズ可能（例: `#range:origin/develop...HEAD`, `#range:HEAD~3..HEAD`）
- 安定性のためVS Code Git Extension APIを使用
- 既存のプロンプトフィルタリングと出力機能を再利用

**Phase 1a (MVP) 対象外:**
- CommandRouterによる大規模リファクタリング（Phase 1bに移動）
- scopeフィールドと二段パイプライン（Phase 2に移動）
- Staged/Unstagedの区別（将来検討）
- 右クリックメニュー統合（将来検討）
- インライン差分デコレーション（将来検討）

## アーキテクチャ概要

### 二段パイプライン方式（scope フィールドによる振り分け）

```
ユーザー: @promptis /codereviewDiff #range:origin/main...HEAD
         ↓
chatHandler() が command を検出
         ↓
CommandRouter [新規] → ReviewCommandHandler を取得
         ↓
DiffReviewCommandHandler [新規] (ReviewCommandHandler実装)
         ├─ getRepository() from gitUtil.ts [新規]
         ├─ extractDiffRange() from util.ts [新規]
         └─ getDiffContent() from gitUtil.ts [新規]
         ↓
┌────────────────────────────────────────────────────────┐
│ Phase 1: ファイル単位レビュー (FileReviewPhase)         │
├────────────────────────────────────────────────────────┤
│ 対象: scope: file のプロンプト                          │
│                                                        │
│ 1. 各DiffResultに対して、既存のfilterPromptsByTarget() │
│    で該当するプロンプトを取得                           │
│    - applyTo: "**/*.tf" → .tf ファイル用              │
│    - applyTo: "**/*.sql" → .sql ファイル用            │
│                                                        │
│ 2. 各ファイル×各プロンプトでレビュー実行               │
│    - プロンプト内容 + 差分 → LLM                       │
│    - レビューテキストを出力                             │
│                                                        │
│ 3. FileReviewResult[] を生成                           │
│    - filePath, diff, reviewText                       │
└────────────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────────────┐
│ Phase 2: 変更集合レビュー (ChangesetReviewPhase)        │
├────────────────────────────────────────────────────────┤
│ 対象: scope: changeset のプロンプト                     │
│                                                        │
│ 1. 全DiffResultをまとめたコンテキストを構築             │
│    - 変更ファイル一覧                                   │
│    - 各ファイルの差分                                   │
│                                                        │
│ 2. 各changesetプロンプトで全体レビュー                  │
│    - プロンプト内容 + コンテキスト → LLM               │
│    - 整合性チェック結果を出力                           │
│      • API変更の整合性                                 │
│      • スキーマ変更の整合性                             │
│      • 設定変更の整合性                                 │
│      • 依存関係の整合性                                 │
└────────────────────────────────────────────────────────┘
         ↓
OutputStrategy (既存を再利用)
```

### 設計原則

- **SOLID原則準拠:**
  - Single Responsibility: 各Phaseは単一の責務
  - Open/Closed: CommandRouterで新コマンド追加が容易
  - Liskov Substitution: ReviewCommandHandler インターフェース
  - Interface Segregation: Phase別インターフェース分離
  - Dependency Inversion: 抽象に依存

## 作成するファイル

### 1. `/workspaces/promptis/src/gitUtil.ts` (新規作成)

**目的:** VS Code Git Extension APIを使用したGit操作ラッパー

**主要インターフェース:**
```typescript
export interface DiffResult {
  filePath: string;        // 絶対パス
  relativePath: string;    // ワークスペースからの相対パス
  diff: string;            // unified diff コンテンツ
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;        // リネームされたファイルの旧パス
  fileExtension: string;   // 例: ".ts", ".sql", ".tf"
}

export interface GitRange {
  base: string;            // 例: "origin/main"
  compare: string;         // 例: "HEAD"
}
```

**主要関数:**
1. `getGitExtension()` - vscode.git拡張機能にアクセス
2. `getRepository(workspaceUri?)` - ワークスペースからリポジトリを取得
3. `parseGitRange(rangeSpec?, defaultBase?)` - "base...compare" 構文をパース
4. `getDefaultBaseBranch(repo)` - デフォルトベースブランチを決定（main/master）
5. `getDiffContent(repo, range)` - Git APIを使用して差分を取得
6. `parseDiffOutput(diffOutput, repoRoot)` - unified diffをDiffResult[]にパース

**エラーハンドリング:**
- Git拡張機能が利用できない場合はundefinedを返す
- リポジトリが見つからない場合はundefinedを返す
- 無効なrefの場合は説明的なエラーをスロー
- バイナリファイルは情報メッセージ付きでスキップ

### 2. `/workspaces/promptis/src/command/CommandRouter.ts` (新規作成)

**目的:** コマンドルーティングのStrategy/Factory パターン実装

**インターフェース:**
```typescript
export interface ReviewCommandHandler {
  handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    promptMetadata: PromptMetadata[]
  ): Promise<void | vscode.ChatResult>;
}
```

**クラス:**
```typescript
export class CommandRouter {
  private handlers: Map<string, ReviewCommandHandler>;

  constructor() {
    this.handlers = new Map([
      // 既存コマンドハンドラー（後方互換性）
      ["codereviewCodeStandards", new FileBasedReviewCommandHandler("codereviewCodeStandards")],
      ["codereviewFunctional", new FileBasedReviewCommandHandler("codereviewFunctional")],
      ["codereviewNonFunctional", new FileBasedReviewCommandHandler("codereviewNonFunctional")],
      ["reverseEngineering", new FileBasedReviewCommandHandler("reverseEngineering")],
      ["drawDiagrams", new FileBasedReviewCommandHandler("drawDiagrams")],

      // 新規差分レビューハンドラー
      ["codereviewDiff", new DiffReviewCommandHandler()],
    ]);
  }

  getHandler(command: string): ReviewCommandHandler | undefined {
    return this.handlers.get(command);
  }
}
```

### 3. `/workspaces/promptis/src/command/FileBasedReviewCommandHandler.ts` (新規作成)

**目的:** 既存のファイルベースレビュー機能をラップ（リファクタリング）

```typescript
export class FileBasedReviewCommandHandler implements ReviewCommandHandler {
  constructor(private commandName: string) {}

  async handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    promptMetadata: PromptMetadata[]
  ): Promise<void | vscode.ChatResult> {
    // 既存のprocessSourceFiles/processSelectedContent ロジック
    const targetFiles = await extractTargetFiles(request, stream);
    if (targetFiles.length > 0) {
      await processSourceFiles(targetFiles, promptMetadata, request.model, token, stream);
    } else {
      await processSelectedContent(promptMetadata, request.model, token, stream);
    }
  }
}
```

### 4. `/workspaces/promptis/src/command/DiffReviewCommandHandler.ts` (新規作成)

**目的:** 差分レビューの二段パイプライン実装

```typescript
export class DiffReviewCommandHandler implements ReviewCommandHandler {
  private fileReviewPhase: FileReviewPhase;
  private changesetReviewPhase: ChangesetReviewPhase;

  constructor() {
    this.fileReviewPhase = new FileReviewPhase();
    this.changesetReviewPhase = new ChangesetReviewPhase();
  }

  async handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    promptMetadata: PromptMetadataWithScope[]
  ): Promise<void | vscode.ChatResult> {
    // 1. Gitリポジトリと差分範囲を取得
    const repo = getRepository();
    if (!repo) {
      return createErrorResponse("⚠️ Gitリポジトリが見つかりません", stream);
    }

    const range = await extractDiffRange(request);
    if (!range) {
      return createErrorResponse("⚠️ 差分範囲を特定できません", stream);
    }

    // 2. 差分を取得
    const diffResults = await getDiffContent(repo, range);
    if (diffResults.length === 0) {
      stream.markdown(`ℹ️ ${range.base}...${range.compare} 間に変更がありません`);
      return;
    }

    stream.markdown(`📊 **${diffResults.length}ファイルの差分をレビュー** (\`${range.base}...${range.compare}\`)\n\n`);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    // 3. Phase 1: ファイル単位レビュー (scope: file)
    stream.markdown(`## ファイル単位レビュー\n\n`);
    const fileResults = await this.fileReviewPhase.execute(
      diffResults,
      promptMetadata,
      request.model,
      token,
      stream,
      workspaceRoot
    );

    // 4. Phase 2: 変更集合レビュー (scope: changeset)
    await this.changesetReviewPhase.execute(
      diffResults,
      fileResults,
      promptMetadata,
      request.model,
      token,
      stream,
      workspaceRoot
    );
  }
}
```

### 5. `/workspaces/promptis/src/review/types.ts` (新規作成)

**目的:** レビュー関連の型定義

```typescript
// ファイル単位レビューの結果
export interface FileReviewResult {
  filePath: string;
  relativePath: string;
  fileExtension: string;
  diff: string;
  reviewText: string;  // LLMによるレビュー本文
}

// プロンプトのスコープ
export type PromptScope = 'file' | 'changeset';

// 拡張されたプロンプトメタデータ
export interface PromptMetadataWithScope extends PromptMetadata {
  scope: PromptScope;  // file=ファイル単位, changeset=変更集合全体
}
```

### 6. `/workspaces/promptis/src/review/FileReviewPhase.ts` (新規作成)

**目的:** ファイル単位のレビュー実行（scope: file）

```typescript
export class FileReviewPhase {
  async execute(
    diffResults: DiffResult[],
    promptMetadata: PromptMetadataWithScope[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream,
    workspaceRoot: string
  ): Promise<FileReviewResult[]> {
    const results: FileReviewResult[] = [];

    // scope: file のプロンプトのみ対象
    const filePrompts = promptMetadata.filter(p => p.scope === 'file');

    if (filePrompts.length === 0) {
      stream.markdown(`⚠️ ファイル単位レビュー用プロンプトが見つかりません\n\n`);
      return results;
    }

    // 各差分ファイルをレビュー
    for (const diffResult of diffResults) {
      if (token.isCancellationRequested) break;

      // 既存の filterPromptsByTarget() で該当プロンプトを取得
      const applicablePrompts = filterPromptsByTarget(
        filePrompts,
        diffResult.filePath,
        workspaceRoot
      );

      if (applicablePrompts.length === 0) {
        stream.markdown(`⚠️ ${diffResult.relativePath}: マッチするプロンプトがありません\n\n`);
        continue;
      }

      stream.markdown(`#### ${diffResult.relativePath}\n\n`);

      // 各プロンプトでレビュー
      let allReviews = '';
      for (const prompt of applicablePrompts) {
        const reviewText = await this.reviewWithPrompt(
          diffResult,
          prompt,
          model,
          token,
          stream
        );
        allReviews += reviewText + '\n\n';
      }

      results.push({
        filePath: diffResult.filePath,
        relativePath: diffResult.relativePath,
        fileExtension: diffResult.fileExtension,
        diff: diffResult.diff,
        reviewText: allReviews,
      });
    }

    return results;
  }

  private async reviewWithPrompt(
    diffResult: DiffResult,
    prompt: PromptMetadata,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream
  ): Promise<string> {
    // プロンプトを構築
    const messages = [
      vscode.LanguageModelChatMessage.User(prompt.content),
      vscode.LanguageModelChatMessage.User(
        `# ${diffResult.relativePath}\n\n\`\`\`diff\n${diffResult.diff}\n\`\`\``
      ),
    ];

    // LLMに送信
    const response = await model.sendRequest(messages, {}, token);

    // ストリーミング出力
    let reviewText = '';
    for await (const chunk of response.text) {
      reviewText += chunk;
      stream.markdown(chunk);
    }
    stream.markdown('\n\n');

    return reviewText;
  }
}
```

### 7. `/workspaces/promptis/src/review/ChangesetReviewPhase.ts` (新規作成)

**目的:** 変更集合全体の整合性チェック（scope: changeset）

```typescript
export class ChangesetReviewPhase {
  async execute(
    diffResults: DiffResult[],
    fileReviewResults: FileReviewResult[],
    promptMetadata: PromptMetadataWithScope[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream,
    workspaceRoot: string
  ): Promise<void> {
    // scope: changeset のプロンプトのみ対象
    const changesetPrompts = promptMetadata.filter(p => p.scope === 'changeset');

    if (changesetPrompts.length === 0) {
      stream.markdown(`ℹ️ 変更集合レビュー用プロンプトが見つかりません\n\n`);
      return;
    }

    stream.markdown(`## 変更集合全体のレビュー\n\n`);

    // 各プロンプトで全体レビュー
    for (const prompt of changesetPrompts) {
      if (token.isCancellationRequested) break;

      await this.reviewWithPrompt(
        diffResults,
        fileReviewResults,
        prompt,
        model,
        token,
        stream
      );
    }
  }

  private async reviewWithPrompt(
    diffResults: DiffResult[],
    fileReviewResults: FileReviewResult[],
    prompt: PromptMetadata,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    stream: vscode.ChatResponseStream
  ): Promise<void> {
    // コンテキストを構築
    let context = `# 変更集合レビュー\n\n`;
    context += `## 変更ファイル一覧\n\n`;
    for (const result of fileReviewResults) {
      context += `- ${result.relativePath} (${result.fileExtension})\n`;
    }
    context += `\n## 各ファイルの差分\n\n`;
    for (const diff of diffResults) {
      context += `### ${diff.relativePath}\n\n`;
      context += `\`\`\`diff\n${diff.diff}\n\`\`\`\n\n`;
    }

    // プロンプトを送信
    const messages = [
      vscode.LanguageModelChatMessage.User(prompt.content),
      vscode.LanguageModelChatMessage.User(context),
    ];

    const response = await model.sendRequest(messages, {}, token);

    stream.markdown(`### ${path.basename(prompt.filePath)}\n\n`);
    for await (const chunk of response.text) {
      stream.markdown(chunk);
    }
    stream.markdown(`\n\n`);
  }
}
```

## 変更するファイル

### 8. `/workspaces/promptis/src/util.ts` (変更)

**Front Matter解析に scope フィールドを追加:**

```typescript
export function parsePromptFile(filePath: string): PromptMetadataWithScope {
  const fileContent = fs.readFileSync(filePath, "utf8");
  const parsed = matter(fileContent);

  let applyToPatterns: string[] = [];
  if (parsed.data.applyTo) {
    applyToPatterns = Array.isArray(parsed.data.applyTo)
      ? parsed.data.applyTo
      : [parsed.data.applyTo];
  }

  // scope フィールドの解析（デフォルト: 'file'）
  let scope: PromptScope = 'file';
  if (parsed.data.scope) {
    const scopeValue = parsed.data.scope.toLowerCase();
    if (scopeValue === 'changeset' || scopeValue === 'file') {
      scope = scopeValue as PromptScope;
    }
  }

  return {
    filePath,
    applyToPatterns,
    content: parsed.content,
    scope,  // 追加
  };
}
```

**関数を追加:**

```typescript
/**
 * チャットリクエストから差分範囲指定を抽出
 * 構文: #range:base...compare
 * @param request - チャットリクエスト
 * @returns GitRangeオブジェクト、または指定されていない場合はundefined
 */
export async function extractDiffRange(
  request: vscode.ChatRequest
): Promise<GitRange | undefined> {
  // gitUtilからインポート
  const { getRepository, parseGitRange, getDefaultBaseBranch } = await import('./gitUtil');

  // プロンプトから #range:spec を抽出
  const rangeMatch = request.prompt.match(/#range:(\S+)/);

  if (rangeMatch) {
    const rangeSpec = rangeMatch[1];
    return parseGitRange(rangeSpec);
  }

  // #range 指定なし → デフォルトを使用
  const repo = getRepository();
  if (!repo) {
    return undefined;
  }

  const defaultBase = await getDefaultBaseBranch(repo);
  return parseGitRange(undefined, defaultBase);
}
```

### 9. `/workspaces/promptis/src/chatHandler.ts` (変更)

**変更内容:**

**a) インポートを追加（ファイル先頭）:**
```typescript
import { CommandRouter } from "./command/CommandRouter";
```

**b) commandPromptDirectoryMap は維持（後方互換性のため）:**
- 既存の `commandPromptDirectoryMap` は `FileBasedReviewCommandHandler` 内で使用
- `CommandRouter` が新しいルーティングを担当

**c) chatHandler を簡潔化（CommandRouter使用）:**

変更前:
```typescript
export const chatHandler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  const command = request.command;
  if (!command) {
    return createErrorResponse("No command specified", stream);
  }

  // ... プロンプトディレクトリ取得
  // ... プロンプトファイル検索
  // ... extractTargetFiles/processSourceFiles 呼び出し
};
```

変更後:
```typescript
export const chatHandler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
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

  // コマンドに対応するプロンプトディレクトリを取得
  const promptDir = getPromptDirectory(command);
  if (!promptDir) {
    return createErrorResponse(`No prompt path found for command: ${command}`, stream);
  }

  // プロンプトファイルを検索・パース
  const promptFiles = findPromptFiles(promptDir, Config.getPromptExcludeFilePatterns());
  if (promptFiles.length === 0) {
    return createErrorResponse(`No prompt files found in ${promptDir}`, stream);
  }
  const promptMetadata = promptFiles.map(parsePromptFile);

  // 出力設定
  const outputDirPath = Config.getChatOutputDirPath();
  const outputMode = Config.getOutputMode();
  warnIfFileOnlyWithoutOutputPath(outputMode, outputDirPath);

  if (outputMode === "file-only" && outputDirPath && outputDirPath.length > 0) {
    stream = new FileChatResponseStreamWrapper(stream, makeChatFilePath(outputDirPath));
  }

  // ハンドラーに処理を委譲
  return await handler.handle(request, context, stream, token, promptMetadata);
};
```

**d) getPromptDirectory() を拡張:**
```typescript
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
```

### 8. `/workspaces/promptis/src/util.ts` (変更)

**関数を追加:**

```typescript
/**
 * チャットリクエストから差分範囲指定を抽出
 * 構文: #range:base...compare
 * @param request - チャットリクエスト
 * @returns GitRangeオブジェクト、または指定されていない場合はundefined
 */
export async function extractDiffRange(
  request: vscode.ChatRequest
): Promise<GitRange | undefined> {
  // gitUtilからインポート
  const { getRepository, parseGitRange, getDefaultBaseBranch } = await import('./gitUtil');

  // プロンプトから #range:spec を抽出
  const rangeMatch = request.prompt.match(/#range:(\S+)/);

  if (rangeMatch) {
    const rangeSpec = rangeMatch[1];
    return parseGitRange(rangeSpec);
  }

  // #range 指定なし → デフォルトを使用
  const repo = getRepository();
  if (!repo) {
    return undefined;
  }

  const defaultBase = await getDefaultBaseBranch(repo);
  return parseGitRange(undefined, defaultBase);
}
```

### 9. `/workspaces/promptis/src/config.ts` (変更)

**メソッドを追加:**

```typescript
/**
 * 差分レビュープロンプトディレクトリパスを取得
 * @returns ディレクトリパス、または未定義
 */
static getCodeReviewDiffPath(): string | undefined {
  return Config.getPath("codeReview.diffPath");
}

/**
 * 差分比較用のデフォルトベースブランチを取得
 * @returns ブランチ名（デフォルト: "origin/main"）
 */
static getDefaultBaseBranch(): string {
  if (!Config.isWorkspaceAvailabile()) {
    return "origin/main";
  }
  return vscode.workspace
    .getConfiguration()
    .get<string>("promptis.git.defaultBaseBranch", "origin/main");
}
```

### 10. `/workspaces/promptis/package.json` (変更)

**a) `contributes.chatParticipants[0].commands` にコマンドを追加（54行目以降）:**
```json
{
  "name": "codereviewDiff",
  "description": "Review Git Diff Changes Only"
}
```

**b) `contributes.configuration.properties` に設定プロパティを追加（75行目以降）:**
```json
"codeReview.diffPath": {
  "type": "string",
  "description": "Absolute path of the directory storing Git diff review prompts",
  "order": 4
},
"promptis.git.defaultBaseBranch": {
  "type": "string",
  "default": "origin/main",
  "description": "Default base branch for diff comparison (e.g., origin/main, origin/master, origin/develop)",
  "order": 10
}
```

**c) 既存プロパティの order 番号を調整**（必要に応じて）

## 実装順序

### Phase 1: 基盤実装（Week 1-2）

#### ステップ1: Git ユーティリティモジュール
1. `/workspaces/promptis/src/gitUtil.ts` を作成
2. `DiffResult`, `GitRange` インターフェースを実装
3. Git APIラッパー関数を実装
4. エラーハンドリングを追加
5. 手動テスト

#### ステップ2: コマンドルーティング基盤
1. `/workspaces/promptis/src/command/` ディレクトリを作成
2. `ReviewCommandHandler` インターフェースを定義
3. `CommandRouter` クラスを実装
4. `FileBasedReviewCommandHandler` を実装（既存機能のリファクタリング）

#### ステップ3: 設定とパッケージ定義
1. `/workspaces/promptis/src/config.ts` にメソッドを追加
2. `/workspaces/promptis/package.json` にコマンドと設定を追加
3. `/workspaces/promptis/src/util.ts` に `extractDiffRange()` を追加

#### ステップ4: chatHandler リファクタリング
1. `chatHandler.ts` を `CommandRouter` ベースに変更
2. 既存コマンドが動作することを確認

### Phase 2: 二段パイプライン実装（Week 3-4）

#### ステップ5: 局所レビューPhase
1. `/workspaces/promptis/src/review/` ディレクトリを作成
2. `LocalReviewResult` インターフェースを定義
3. `LocalReviewPhase` クラスを実装
   - 拡張子別グループ化
   - プロンプトフィルタリング
   - 構造化プロンプト生成
   - LLM応答パース（初期版：簡易パーサー）
4. 単体テスト

#### ステップ6: 全体整合性Phase
1. `GlobalReviewPhase` クラスを実装
   - 中間成果物の集約
   - 全体整合性プロンプト生成
   - LLM呼び出し
2. 単体テスト

#### ステップ7: 差分レビューハンドラー
1. `DiffReviewCommandHandler` クラスを実装
2. 二段パイプラインの統合
3. エラーハンドリング
4. 統合テスト

### Phase 3: テストと改善（Week 5）

#### ステップ8: 包括的テスト
1. 様々なGitシナリオで手動テスト
2. 拡張子別レビューのテスト（.ts, .py, .sql, .tf など）
3. 全体整合性チェックのテスト
4. エラーケースのテスト
5. 出力モードのテスト

#### ステップ9: 構造化パーサー改善
1. LLM応答の堅牢なパース実装
2. JSON形式を要求する方式への切り替え（オプション）
3. エラーハンドリングの強化

## 主要なエッジケース

| シナリオ | ハンドリング方法 |
|----------|------------------|
| Gitリポジトリなし | エラー表示: "⚠️ Gitリポジトリが見つかりません" |
| 無効なGit範囲 | エラー表示（例付き）: `#range:origin/main...HEAD` |
| Git拡張機能なし | エラー表示: "Git拡張機能をインストールしてリロード" |
| 空の差分 | 情報表示: "ℹ️ XとY間に変更が見つかりません" |
| バイナリファイル | 通知付きでスキップ |
| マージコンフリクト | 差分にそのまま含める |
| 大きな差分（>10k行） | Phase 1では制限なし（将来: チャンク化を追加） |
| 削除されたファイル | changeType='deleted' で含める |
| リネームされたファイル | DiffResult に oldPath を含める |
| キャンセル | token.isCancellationRequested をチェック |
| マッチするプロンプトなし | スキップされたファイルリストに表示 |

## テスト戦略

### 手動テストシナリオ
- [ ] デフォルト範囲で `/codereviewDiff`
- [ ] `/codereviewDiff #range:origin/main...HEAD`
- [ ] `/codereviewDiff #range:HEAD~3..HEAD`
- [ ] Gitリポジトリなしエラー
- [ ] 無効な範囲エラー
- [ ] 空の差分（変更なし）
- [ ] 複数ファイルの変更
- [ ] リネームされたファイル
- [ ] 削除されたファイル
- [ ] 追加されたファイル
- [ ] 変更されたファイル
- [ ] `applyTo` パターンでプロンプトフィルタリング
- [ ] file-only 出力モード
- [ ] キャンセル

### ユニットテスト（後で追加）
- `gitUtil.test.ts`: Git APIラッパー、パース、範囲ハンドリング
- `util.test.ts`: extractDiffRange() 関数
- `chatHandler.test.ts`: エンドツーエンド差分レビューフロー

## 使用例

```
# デフォルト: origin/main と比較
@promptis /codereviewDiff

# カスタム範囲: develop ブランチと比較
@promptis /codereviewDiff #range:origin/develop...HEAD

# 直近5コミットをレビュー
@promptis /codereviewDiff #range:HEAD~5..HEAD
```

## 注意事項

- **VS Code Git API:** `vscode.extensions.getExtension('vscode.git')` でアクセス
- **差分形式:** Unified diff形式（Git標準）
- **プロンプトフィルタリング:** `applyToPatterns` で既存の `filterPromptsByTarget()` を再利用
- **出力戦略:** 既存の `OutputStrategyFactory` を再利用（chat-only/file-only）
- **後方互換性:** 既存コマンドへの破壊的変更なし

## プロンプト設計ガイドライン

差分レビュー用プロンプトは、`codeReview.diffPath` で指定されたディレクトリに配置します。

### Front Matter の scope フィールド

プロンプトには `scope` フィールドを指定して、レビューの対象を明示します：

- **`scope: file`** (デフォルト): ファイル単位のレビュー。applyToパターンで対象ファイルを指定。
- **`scope: changeset`**: 変更集合全体のレビュー。全ての差分ファイルをまとめて評価。

**後方互換性**: scope 未指定の場合は `scope: file` として扱われます。

### 1. ファイル単位プロンプト（scope: file）

拡張子や言語ごとに専門的な観点でレビューします。

**プロンプトファイルの構造:**

```markdown
---
scope: file
applyTo:
  - "**/*.tf"   # Terraformファイル用
---

# Terraform差分レビュー

以下の観点でレビューしてください:

1. **状態管理**: ステートファイルへの影響を確認
2. **破壊的変更**: リソース再作成が必要な変更の検出
3. **権限設定**: IAMロール・ポリシーの適切性
4. **依存関係**: リソース間の依存順序

指摘事項があれば、具体的な改善案と共に記載してください。
```

**拡張子別プロンプト例:**

| 拡張子 | 主な観点 | プロンプトファイル例 |
|--------|----------|---------------------|
| .tf | 状態管理・破壊的変更・権限 | `terraform-review.md` |
| .sql | 互換性・ロック・インデックス | `sql-review.md` |
| .py | 例外設計・型・並行性 | `python-review.md` |
| .ts | 型安全性・非同期処理 | `typescript-review.md` |
| .java | スレッド安全性・メモリ管理 | `java-review.md` |

### 2. 変更集合プロンプト（scope: changeset）

複数ファイルにまたがる整合性をチェックします。

**プロンプトファイルの構造:**

```markdown
---
scope: changeset
# applyToは不要（全ファイルが対象）
---

# 変更集合の整合性チェック

以下の観点で、複数ファイルにまたがる整合性を確認してください:

1. **API変更の整合性**:
   - インターフェース変更に対応する呼び出し側の更新が含まれているか
   - 互換性が保たれているか、破壊的変更の場合は適切に対処されているか

2. **スキーマ変更の整合性**:
   - データベーススキーマ変更に対応するマイグレーション手順が含まれているか
   - ロールバック手順は考慮されているか

3. **設定変更の整合性**:
   - 設定ファイルの変更に対応するデプロイ手順やドキュメント更新が含まれているか
   - 環境間の差異は適切に管理されているか

4. **依存関係の整合性**:
   - ファイル間の依存関係に矛盾や更新漏れがないか
   - import/require文と実際のファイル構造が一致しているか

5. **セキュリティリスク**:
   - 複数ファイルにまたがるセキュリティリスクがないか
   - 認証・認可の変更が一貫しているか

6. **パフォーマンス影響**:
   - 複数の変更が複合的にパフォーマンスに悪影響を与えないか

問題がある場合は具体的に指摘し、推奨される対応を提示してください。
```

### ディレクトリ構成例

```
codeReview.diffPath/
├── file/                      # ファイル単位レビュー用
│   ├── terraform-review.md    # scope: file, applyTo: **/*.tf
│   ├── sql-review.md          # scope: file, applyTo: **/*.sql
│   ├── python-review.md       # scope: file, applyTo: **/*.py
│   └── typescript-review.md   # scope: file, applyTo: **/*.ts
│
└── changeset/                 # 変更集合レビュー用
    ├── api-consistency.md     # scope: changeset
    ├── schema-consistency.md  # scope: changeset
    └── overall-review.md      # scope: changeset
```

**ポイント**: ディレクトリ分割は人間の認知負荷を下げるため。実行器は `scope` フィールドで機械的に判定します。

## 重要ファイルまとめ

### 新規作成ファイル
1. `/workspaces/promptis/src/gitUtil.ts` - 約400行
   - Git APIラッパー、差分取得・パース
2. `/workspaces/promptis/src/command/CommandRouter.ts` - 約50行
   - コマンドルーティングのStrategy/Factory実装
3. `/workspaces/promptis/src/command/FileBasedReviewCommandHandler.ts` - 約30行
   - 既存機能のリファクタリング
4. `/workspaces/promptis/src/command/DiffReviewCommandHandler.ts` - 約60行
   - 差分レビューのオーケストレーション
5. `/workspaces/promptis/src/review/types.ts` - 約20行
   - レビュー関連の型定義
6. `/workspaces/promptis/src/review/FileReviewPhase.ts` - 約100行
   - ファイル単位レビュー実装（scope: file）
7. `/workspaces/promptis/src/review/ChangesetReviewPhase.ts` - 約80行
   - 変更集合レビュー実装（scope: changeset）

### 変更ファイル
8. `/workspaces/promptis/src/util.ts` - 約50行追加
   - parsePromptFile() に scope 解析追加
   - extractDiffRange() 関数追加
9. `/workspaces/promptis/src/chatHandler.ts` - 約50行変更
   - CommandRouterベースへリファクタリング
10. `/workspaces/promptis/src/config.ts` - 約15行追加
    - getCodeReviewDiffPath(), getDefaultBaseBranch()
11. `/workspaces/promptis/package.json` - 約20行追加
    - コマンド・設定定義

**合計:** 約875行の新規/変更コード

## まとめ

この実装計画は、シンプルでありながら強力な差分レビュー機能を実現します：

### 主要な特徴

1. **scope フィールドによる明確な振り分け**:
   - `scope: file` - ファイル単位レビュー（既存のapplyToマッチング活用）
   - `scope: changeset` - 変更集合全体レビュー（クロスファイル整合性）

2. **既存機能の最大限活用**:
   - filterPromptsByTarget() でプロンプトフィルタリング
   - applyTo パターンで拡張子・パス指定
   - 構造化抽出は行わず、LLMに任せる（シンプル化）

3. **SOLID原則に基づく設計**:
   - CommandRouter で拡張性の高いルーティング
   - ReviewCommandHandler インターフェースで抽象化
   - 各Phase が単一責任を持つ

4. **後方互換性の維持**:
   - 既存コマンドは FileBasedReviewCommandHandler でラップ
   - scope 未指定は `scope: file` として扱う
   - 既存のプロンプトは変更不要

### 実装の優先順位

**Phase 1（基盤）**: Git統合、CommandRouter、基本的なファイルレビュー
**Phase 2（高度化）**: 変更集合レビュー、プロンプト設計ガイドライン作成
**Phase 3（改善）**: テスト、パフォーマンス最適化、ユーザーフィードバック対応

段階的に実装することで、リスクを抑えながら確実に機能を追加していきます。

---

## 実装進捗

### Phase 1: 基盤実装 ✅ 完了（2026-01-10）

**実装済みファイル:**
- ✅ `src/gitUtil.ts` - Git API統合、差分取得・パース機能
- ✅ `src/command/CommandRouter.ts` - コマンドルーティング基盤
- ✅ `src/command/ReviewCommandHandler.ts` - ハンドラーインターフェース
- ✅ `src/command/FileBasedReviewCommandHandler.ts` - 既存機能ラップ
- ✅ `src/command/DiffReviewCommandHandler.ts` - 差分レビュー実装
- ✅ `src/reviewService.ts` - レビュー処理の共通化
- ✅ `src/config.ts` - 設定メソッド追加
- ✅ `src/chatHandler.ts` - CommandRouterベースへリファクタリング
- ✅ `package.json` - コマンドと設定プロパティ追加

**動作確認:**
- ✅ 型チェック成功
- ✅ コンパイル成功
- ✅ 全テスト成功（133 passing）
- ✅ 既存機能の後方互換性維持

**実装された機能:**
- Git差分取得（`origin/main...HEAD` デフォルト、`#range:` カスタマイズ可能）
- ファイル単位の差分レビュー
- プロンプトフィルタリング（既存の `applyTo` パターン活用）
- `/codereviewDiff` コマンド

**未実装（Phase 2以降）:**
- `scope` フィールドによる二段パイプライン（file/changeset）
- FileReviewPhase、ChangesetReviewPhase
- 変更集合全体の整合性チェック
