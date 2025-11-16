# Front Matter機能実装計画

## 概要

Issue #106で提案されたファイル拡張子ごとのレビュープロンプト管理機能を実装します。
プロンプトファイル（`.md`）にFront Matter形式で `applyTo` フィールドを追加し、対象ファイルの拡張子を指定できるようにします。

参考: https://zenn.dev/m10maeda/articles/copilot-multi-instruction-files

## Front Matter仕様

### 基本形式

```markdown
---
applyTo: "*.java"
---
あなたは極めて優秀なJavaプログラマーで、Javaコーディング規約に対する責任を持っています。
...
```

### 複数拡張子対応

```markdown
---
applyTo: ["*.java", "*.kt"]
---
```

### Globパターン対応

```markdown
---
applyTo: "src/**/*.py"
---
```

### 後方互換性

`applyTo` が未指定の場合は、全てのファイルに適用されます（既存動作と同じ）。

## 現状分析

### 現在の処理フロー

1. **プロンプトファイル収集** (`src/chatHandler.ts:54-58`)
   - `findPromptFiles()` でディレクトリ内の全`.md`ファイルを取得

2. **出力モード設定** (`src/chatHandler.ts:60-70`)
   - `OutputStrategyFactory`を使用した出力戦略パターン
   - chat-only, file-only, bothの3モードをサポート

3. **ファイル処理** (`src/chatHandler.ts:72-79`)
   - 対象ファイルがある場合: `processSourceFiles()` → 各ファイルに対して `processContent()`
   - 選択範囲の場合: `processSelectedContent()` → `processContent()`

4. **プロンプト適用** (`src/chatHandler.ts:177`)
   - `processContent()` 内で、**全てのプロンプトファイル**をループで処理
   - 各プロンプトを読み込んでLLMに送信
   - `OutputStrategy.outputReviewDetails()`で出力

### 問題点

- 全てのプロンプトが全てのファイルに適用される
- ファイル拡張子ごとに異なるレビュー観点を持つことができない
- 設定画面で都度プロンプトディレクトリを切り替える必要がある

## 実装設計

### 1. 依存関係の追加

**ライブラリ**: `gray-matter`
- 理由: 広く使われているFront Matter解析ライブラリ、軽量で信頼性が高い
- インストール: `npm install gray-matter`
- 型定義: `npm install --save-dev @types/gray-matter`

**既存の依存関係**:
- `minimatch`: 既にインストール済み（`package.json` L165）
  - Globパターンマッチングに使用

### 2. 新規型定義とユーティリティ関数 (`src/util.ts`)

#### 2.1 型定義

```typescript
/**
 * プロンプトファイルのメタデータ
 */
export interface PromptMetadata {
  filePath: string;           // プロンプトファイルのパス
  applyToPatterns: string[];  // Front Matterで指定されたパターン（空配列=全適用）
  content: string;            // Front Matter除外後のコンテンツ
}
```

#### 2.2 Front Matter解析関数

```typescript
/**
 * プロンプトファイルのFront Matterを解析し、メタデータを取得
 *
 * @param filePath - プロンプトファイルのパス
 * @returns PromptMetadata
 *
 * @example
 * const meta = parsePromptFile('/path/to/prompt.md');
 * // meta.applyToPatterns が空の場合は全ファイル対象（後方互換性）
 */
export function parsePromptFile(filePath: string): PromptMetadata {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(fileContent);

  let applyToPatterns: string[] = [];
  if (parsed.data.applyTo) {
    // 文字列または配列に対応
    applyToPatterns = Array.isArray(parsed.data.applyTo)
      ? parsed.data.applyTo
      : [parsed.data.applyTo];
  }

  return {
    filePath,
    applyToPatterns,  // 空配列の場合は全ファイル対象（後方互換性）
    content: parsed.content
  };
}
```

#### 2.3 プロンプトフィルタリング関数

```typescript
/**
 * 対象ファイルパスに適用すべきプロンプトメタデータをフィルタリング
 *
 * @param promptMetadata - プロンプトメタデータの配列
 * @param targetFilePath - 対象ファイルのパス
 * @returns フィルタリングされたプロンプトメタデータの配列
 *
 * @example
 * const applicable = filterPromptsByTarget(allPrompts, 'src/Main.java');
 * // *.java にマッチするプロンプトのみ返される
 */
export function filterPromptsByTarget(
  promptMetadata: PromptMetadata[],
  targetFilePath: string
): PromptMetadata[] {
  return promptMetadata.filter(meta => {
    // applyToPatternsが空の場合は全ファイル対象（後方互換性）
    if (meta.applyToPatterns.length === 0) {
      return true;
    }

    // いずれかのパターンにマッチすれば適用
    return meta.applyToPatterns.some(pattern =>
      minimatch(targetFilePath, pattern, { matchBase: true })
    );
  });
}
```

### 3. OutputStrategyパターンとの統合方針

**設計方針**:
- **Front Matterフィルタリング**: `chatHandler.ts`内で処理
- **OutputStrategy**: 出力のみを担当（現在の責務を維持）

現在のコードでは`OutputStrategyFactory`が以下の3つの出力モードを提供：
- `chat-only`: チャットのみに出力
- `file-only`: ファイルのみに出力
- `both`: 両方に出力

Front Matter機能の実装では：
- ✅ `filterPromptsByTarget()`でプロンプトを事前にフィルタリング
- ✅ `strategy.outputReviewDetails(meta.filePath, contentFilePath, stream)`は変更なし
- ✅ Strategyパターンの実装クラス（ChatOnlyStrategy, FileOnlyStrategy等）は修正不要

### 4. `chatHandler.ts` の修正

#### 4.1 プロンプトメタデータの読み込み (L54-58付近)

```typescript
// 変更前
const promptFiles = findPromptFiles(promptDir, Config.getPromptExcludeFilePatterns());
if (promptFiles.length === 0) {
  return createErrorResponse(`No prompt files found in ${promptDir}`, stream);
}

// 変更後
const promptFiles = findPromptFiles(promptDir, Config.getPromptExcludeFilePatterns());
if (promptFiles.length === 0) {
  return createErrorResponse(`No prompt files found in ${promptDir}`, stream);
}
const promptMetadata = promptFiles.map(parsePromptFile);
```

#### 4.2 `processSourceFiles()` の修正（L97-126）

```typescript
export async function processSourceFiles(
  sourcePaths: string[],
  promptMetadata: PromptMetadata[],  // 型変更: string[] → PromptMetadata[]
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  let counter = 0;
  const sourceNum = sourcePaths.length;

  // ソースファイルを軸にして、プロンプトを適用していく
  for (const sourcePath of sourcePaths) {
    stream.markdown(`progress: ${counter + 1}/${sourceNum}\\n`);
    stream.markdown(`----\\n`);

    const content = fs.readFileSync(sourcePath, { encoding: "utf8" });

    // 対象ファイルに適用可能なプロンプトのみをフィルタリング
    const applicablePrompts = filterPromptsByTarget(promptMetadata, sourcePath);

    if (applicablePrompts.length === 0) {
      stream.markdown(`⚠️ No prompts matched for file: ${path.basename(sourcePath)}\\n`);
      continue;
    }

    stream.markdown(`Applying ${applicablePrompts.length} prompt(s) to ${path.basename(sourcePath)}\\n`);
    await processContent(content, sourcePath, applicablePrompts, model, token, stream);
    counter++;
  }
}
```

#### 4.3 `processSelectedContent()` の修正（L128-163）

```typescript
export async function processSelectedContent(
  promptMetadata: PromptMetadata[],  // 型変更: string[] → PromptMetadata[]
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    stream.markdown("No active editor found\\n");
    return;
  }

  const selection = editor.selection;
  const content = editor.document.getText(selection);

  // アクティブエディタのファイルパスを取得してフィルタリング
  const activeFilePath = editor.document.uri.fsPath;
  const applicablePrompts = filterPromptsByTarget(promptMetadata, activeFilePath);

  if (applicablePrompts.length === 0) {
    stream.markdown(`⚠️ No prompts matched for file: ${path.basename(activeFilePath)}\\n`);
    return;
  }

  stream.markdown(`Applying ${applicablePrompts.length} prompt(s) to selection\\n`);
  await processContent(content, "Selection", applicablePrompts, model, token, stream);
}
```

#### 4.4 `processContent()` の修正（L166-226）

```typescript
export async function processContent(
  content: string,
  contentFilePath: string,
  promptMetadata: PromptMetadata[],  // 型変更: string[] → PromptMetadata[]
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  // OutputStrategyを取得（既存の実装）
  const outputMode = Config.getOutputMode();
  const strategy = OutputStrategyFactory.create(outputMode);

  for (const meta of promptMetadata) {
    const promptContent = meta.content;  // Front Matter除外済みコンテンツ
    const messages = [
      vscode.LanguageModelChatMessage.User(promptContent),
      vscode.LanguageModelChatMessage.User(content),
    ];

    try {
      stream.markdown(`## Review Details \\n\\n`);

      // OutputStrategyを使用して出力（既存の実装を維持）
      strategy.outputReviewDetails(meta.filePath, contentFilePath, stream);
      stream.markdown(`----\\n`);

      // プロンプトを送信し、GitHub Copilot の AI モデルから応答を受信、出力する
      const res = await model.sendRequest(messages, {}, token);
      for await (const fragment of res.text) {
        stream.markdown(fragment);
      }
    } catch (error) {
      // エラーハンドリング（既存と同じ）
      if (error instanceof vscode.LanguageModelError) {
        console.error(error.message, error.code, error.cause);
        stream.markdown(`Error occurred: ${error.message}\n`);
      } else {
        throw error;
      }
    } finally {
      stream.markdown("\\n\\n");
      if (stream instanceof FileChatResponseStreamWrapper) {
        stream.writeToFile();
      }
    }
  }
}
```

#### 4.5 `chatHandler` メイン関数の修正（L40-79）

```typescript
chatHandler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  // ... 既存のコマンド取得処理 ...

  // 格納ディレクトリからプロンプトのファイルを取得する
  const promptFiles = findPromptFiles(promptDir, Config.getPromptExcludeFilePatterns());
  if (promptFiles.length === 0) {
    return createErrorResponse(`No prompt files found in ${promptDir}`, stream);
  }

  // プロンプトファイルのメタデータを解析
  const promptMetadata = promptFiles.map(parsePromptFile);

  // ... 既存の出力設定処理 ...

  // ユーザーの Chat Request 中で指定されたレビュー対象ファイルを取得する
  const targetFiles = await extractTargetFiles(request, stream);
  if (targetFiles.length > 0) {
    // ファイル指定があれば、当該ファイルをレビューする
    await processSourceFiles(targetFiles, promptMetadata, request.model, token, stream);
  } else {
    // ファイル指定がなければ、エディタで選択されている内容をレビューする
    await processSelectedContent(promptMetadata, request.model, token, stream);
  }
};
```

## テスト戦略

### 1. ユニットテスト (`src/test/util.test.ts`)

```typescript
suite("Front Matter Parsing Test Suite", () => {
  test("単一のapplyToパターンをパースできること", () => {
    // Front Matterあり・単一パターン
    // 期待値: applyToPatterns = ["*.java"]
  });

  test("複数のapplyToパターンをパースできること", () => {
    // Front Matterあり・複数パターン
    // 期待値: applyToPatterns = ["*.java", "*.kt"]
  });

  test("Front Matterがない場合は空配列を返すこと", () => {
    // Front Matterなし（後方互換性）
    // 期待値: applyToPatterns = []
  });

  test("Front Matter部分がコンテンツから除外されること", () => {
    // Front Matter部分がcontentに含まれないことを確認
  });
});

suite("Prompt Filtering Test Suite", () => {
  test("ファイル拡張子に基づいてマッチングできること", () => {
    // *.java に対して *.java パターンがマッチ
  });

  test("applyToが未指定の場合は全プロンプトを適用すること", () => {
    // applyToPatterns が空の場合は全適用（後方互換性）
  });

  test("Globパターンをサポートすること", () => {
    // src/**/*.py などの複雑なパターン
  });

  test("複数パターンをサポートすること", () => {
    // ["*.java", "*.kt"] のような複数パターン
  });

  test("matchBaseオプションが有効であること", () => {
    // パス全体でなくファイル名のみでマッチング
  });
});
```

### 2. 統合テスト (`src/test/chatHandler.test.ts`)

```typescript
suite("Chat Handler with Front Matter Test Suite", () => {
  test("対象ファイルにマッチするプロンプトのみ適用されること", () => {
    // .java ファイルには *.java プロンプトのみ適用
  });

  test("Front Matterがない場合は全プロンプトが適用されること", () => {
    // 後方互換性テスト
    // Front Matterなしのプロンプトは全ファイルに適用
  });

  test("マッチするプロンプトがない場合はスキップされること", () => {
    // マッチするプロンプトがない場合のスキップ処理
  });

  test("選択範囲レビュー時はアクティブファイルの拡張子でフィルタリングされること", () => {
    // 選択範囲レビュー時のフィルタリング
  });

  test("Front Matterが除外されたコンテンツが使用されること", () => {
    // Front Matterが除外されたコンテンツが使用されることを確認
  });
});
```

### 3. テストデータ

テスト用プロンプトファイルを `src/test/__tests__/` に配置：

- `test_prompt_java.md`: `applyTo: "*.java"`
- `test_prompt_python.md`: `applyTo: "*.py"`
- `test_prompt_multi.md`: `applyTo: ["*.ts", "*.tsx"]`
- `test_prompt_no_frontmatter.md`: Front Matterなし

## 後方互換性の保証

### 重要原則

**`applyToPatterns` が空配列の場合は全ファイルに適用**

この設計により：
- ✅ 既存のFront Matterなしプロンプトファイルは引き続き動作
- ✅ 新規プロンプトファイルは任意でFront Matterを追加可能
- ✅ 設定変更不要
- ✅ コマンド追加不要

### 動作確認項目

1. Front Matterなしの既存プロンプトが全ファイルに適用されること
2. Front Matterありのプロンプトが指定拡張子にのみ適用されること
3. Front Matterあり/なしが混在しても正常動作すること

## 実装フェーズ

### Phase 1: 依存関係追加（5分）
- [ ] `gray-matter` のインストール
- [ ] `@types/gray-matter` のインストール
- [ ] `package.json` の更新
- ✅ `minimatch` は既にインストール済み

### Phase 2: ユーティリティ関数実装（30分）
- [ ] `PromptMetadata` 型定義の追加
- [ ] `parsePromptFile()` の実装
- [ ] `filterPromptsByTarget()` の実装
- [ ] ユニットテストの追加
- [ ] テスト実行と修正

### Phase 3: chatHandler統合（45分）
- [ ] `processContent()` シグネチャ変更
  - ⚠️ OutputStrategyパターンを維持すること
  - `strategy.outputReviewDetails(meta.filePath, ...)`を使用
- [ ] `processSourceFiles()` の修正
  - フィルタリング処理を追加
- [ ] `processSelectedContent()` の修正
  - アクティブファイルパスでのフィルタリング処理を追加
- [ ] `chatHandler` メイン関数の修正
  - プロンプトメタデータの解析を追加
- [ ] エラーハンドリングの追加

### Phase 4: テスト追加（60分）
- [ ] テスト用プロンプトファイルの作成
- [ ] 統合テストの追加
- [ ] 後方互換性テストの追加
- [ ] エッジケーステストの追加
- [ ] 全テスト実行と修正

### Phase 5: サンプル・ドキュメント更新（15分）
- [ ] `prompts/codestandards/` にFront Matter付きサンプル追加
- [ ] README.md の更新
- [ ] CHANGELOG.md の更新

**合計見積もり**: 約2.5時間

## エッジケースとエラーハンドリング

### 1. 不正なFront Matter形式
```typescript
// gray-matterはパースエラー時も安全に処理
// data が空オブジェクトになるため、applyToPatterns = [] となり全適用
```

### 2. プロンプトが1つも適用されない場合
```typescript
if (applicablePrompts.length === 0) {
  stream.markdown(`⚠️ No prompts matched for file: ${path.basename(sourcePath)}\n`);
  continue;
}
```

### 3. 複数ファイル処理時のログ出力
```typescript
stream.markdown(`Applying ${applicablePrompts.length} prompt(s) to ${path.basename(sourcePath)}\n`);
```

### 4. 選択範囲レビュー時のアクティブエディタ取得失敗
```typescript
const editor = vscode.window.activeTextEditor;
if (!editor) {
  stream.markdown("No active editor found\n");
  return;
}
```

### 5. パターンマッチングの詳細設定
```typescript
minimatch(targetFilePath, pattern, { matchBase: true })
// matchBase: true により、パス全体でなくファイル名のみでマッチング可能
```

## 使用例

### プロンプトファイル構成例

```
prompts/codestandards/
├── 01_java_readability.md       (applyTo: "*.java")
├── 02_java_naming.md            (applyTo: "*.java")
├── 03_python_pep8.md            (applyTo: "*.py")
├── 04_typescript_style.md       (applyTo: ["*.ts", "*.tsx"])
├── 05_general_security.md       (applyTo未指定 = 全ファイル対象)
└── 06_sql_injection.md          (applyTo: "*.sql")
```

### レビュー実行時の動作

```typescript
// 例: Main.java をレビュー
// → 01_java_readability.md, 02_java_naming.md, 05_general_security.md が適用される

// 例: app.py をレビュー
// → 03_python_pep8.md, 05_general_security.md が適用される

// 例: component.tsx をレビュー
// → 04_typescript_style.md, 05_general_security.md が適用される
```

## 実装上の注意点

1. **OutputStrategyパターンとの統合**
   - OutputStrategyの責務は変更しない（出力のみを担当）
   - Front Matterフィルタリングは`chatHandler.ts`内で処理
   - `strategy.outputReviewDetails()`のシグネチャは変更しない
   - 既存のfile-only, chat-only, bothモードの動作を維持

2. **パフォーマンス**
   - Front Matter解析は最初の1回のみ（プロンプトファイル読み込み時）
   - フィルタリングはminimatchで高速

3. **エラーメッセージ**
   - ユーザーフレンドリーなメッセージを心がける
   - マッチしないファイルは警告を出すが処理は継続

4. **ログ出力**
   - 適用されるプロンプト数を表示
   - デバッグ時に役立つ情報を出力

5. **テスト**
   - 後方互換性テストは必須
   - エッジケースも網羅的にテスト
   - OutputStrategy各モードでの動作確認

## リリース後の対応

### ドキュメント
- [ ] READMEにFront Matter機能の説明を追加
- [ ] サンプルプロンプトファイルの提供
- [ ] マイグレーションガイド（不要だが説明は必要）

### Issue対応
- [ ] Issue #106 をクローズ
- [ ] 使用例のコメント追加

### 今後の拡張可能性
- Front Matterに他のメタデータを追加可能（例: `priority`, `description`）
- 除外パターン（`excludeFrom`）の追加
- プロンプトの依存関係管理

---

**作成日**: 2025-11-12
**対象Issue**: #106
**担当**: Claude Code
