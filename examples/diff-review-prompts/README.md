# Git差分レビュープロンプト サンプル集

このディレクトリには、`/codereviewDiff`コマンドで使用するサンプルプロンプトが含まれています。

## ディレクトリ構成

```
diff-review-prompts/
├── file/                      # ファイル単位レビュー用プロンプト（scope: file）
│   ├── terraform-review.md   # Terraformファイル専用レビュー
│   ├── sql-review.md         # SQLファイル専用レビュー
│   ├── python-review.md      # Pythonファイル専用レビュー
│   └── typescript-review.md  # TypeScript/Reactファイル専用レビュー
│
└── changeset/                # 変更集合レビュー用プロンプト（scope: changeset）
    ├── api-consistency.md     # API変更の整合性チェック
    ├── schema-consistency.md  # スキーマ変更の整合性チェック
    └── overall-review.md      # 変更集合全体のレビュー
```

## プロンプトの種類

### 1. ファイル単位レビュー（scope: file）

`file/`ディレクトリ内のプロンプトは、個々の差分ファイルに対してレビューを実行します。

**特徴:**
- `applyTo`パターンで対象ファイルを指定
- 各ファイルの差分に対して個別にレビュー実行
- 言語やファイルタイプ固有の観点でチェック

**例:**
- `terraform-review.md`: `**/*.tf`にマッチ
- `sql-review.md`: `**/*.sql`にマッチ
- `python-review.md`: `**/*.py`にマッチ
- `typescript-review.md`: `**/*.ts`, `**/*.tsx`にマッチ

### 2. 変更集合レビュー（scope: changeset）

`changeset/`ディレクトリ内のプロンプトは、変更されたすべてのファイルをまとめてレビューします。

**特徴:**
- `applyTo`は不要（全ファイルが対象）
- 複数ファイルにまたがる整合性をチェック
- クロスファイルの依存関係や影響を評価

**例:**
- `api-consistency.md`: APIの定義と呼び出し側の整合性
- `schema-consistency.md`: DBスキーマとコードの整合性
- `overall-review.md`: 変更全体の品質と整合性

## 使い方

### 1. VS Code設定でプロンプトディレクトリを指定

`.vscode/settings.json`または`settings.json`に以下を追加：

```json
{
  "promptis.codeReview.diffPath": "/path/to/examples/diff-review-prompts"
}
```

### 2. デフォルトベースブランチの設定（オプション）

```json
{
  "promptis.git.defaultBaseBranch": "origin/main"  // デフォルト値
}
```

### 3. コマンド実行

GitHub Copilot Chatで以下のコマンドを実行：

```
# デフォルト: origin/main...HEAD の差分をレビュー
@promptis /codereviewDiff

# カスタム範囲指定
@promptis /codereviewDiff #range:origin/develop...HEAD

# 直近5コミットをレビュー
@promptis /codereviewDiff #range:HEAD~5..HEAD
```

## レビューフロー

### Phase 1: ファイル単位レビュー

1. 各差分ファイルに対して、`applyTo`パターンにマッチするプロンプトを検索
2. マッチしたプロンプトで個別にレビュー実行
3. ファイルごとにレビュー結果を出力

**例:** `main.tf`が変更されている場合、`terraform-review.md`が適用されます。

### Phase 2: 変更集合レビュー

1. すべての差分ファイルをまとめたコンテキストを構築
2. `scope: changeset`のプロンプトで全体レビュー実行
3. クロスファイルの整合性チェック結果を出力

**例:** APIの定義変更と呼び出し側の変更が一貫しているかをチェック。

## カスタマイズ方法

### 新しいファイル単位プロンプトの追加

1. `file/`ディレクトリに`.md`ファイルを作成
2. Front Matterで`scope: file`と`applyTo`を指定

```markdown
---
scope: file
applyTo:
  - "**/*.java"
---

# Javaコードレビュー

レビュー観点を記載...
```

### 新しい変更集合プロンプトの追加

1. `changeset/`ディレクトリに`.md`ファイルを作成
2. Front Matterで`scope: changeset`を指定（`applyTo`は不要）

```markdown
---
scope: changeset
---

# パフォーマンス影響チェック

複数の変更が複合的にパフォーマンスに与える影響を確認...
```

## プロンプト設計のベストプラクティス

### 1. 明確なレビュー観点
- 具体的なチェック項目をリスト化
- 各観点について何を確認すべきか明記

### 2. 出力形式の統一
- レビュー結果の形式を指定
- 問題の重要度（高/中/低）を分類
- 推奨対応策を含める

### 3. 言語・技術固有の知識
- ファイル単位プロンプトは言語固有の観点を含める
- フレームワークやライブラリのベストプラクティスを反映

### 4. 変更集合プロンプトは横断的視点
- 単一ファイルでは検出できない問題に焦点
- 整合性、依存関係、影響範囲を重視

## トラブルシューティング

### プロンプトが適用されない

**原因:** `applyTo`パターンがファイルパスにマッチしていない

**解決策:**
- Globパターンの確認（`**/*.ts`は再帰的、`*.ts`は直下のみ）
- ファイル拡張子の確認

### 変更集合レビューが実行されない

**原因:** `scope: changeset`のプロンプトが存在しない

**解決策:**
- `changeset/`ディレクトリにプロンプトを配置
- Front Matterで`scope: changeset`を指定

### レビュー結果が長すぎる

**解決策:**
- プロンプトで簡潔な出力を指示
- 重要度が高い指摘のみを求める
- 必要に応じてファイル出力モードを使用

## 関連ドキュメント

- [実装計画書](/plan/issue-112.md)
- [VS Code拡張機能設定](../../README.md)

## サンプルプロンプトのライセンス

これらのサンプルプロンプトは自由に変更・カスタマイズして使用できます。
プロジェクトの特性に合わせて、レビュー観点や出力形式を調整してください。
