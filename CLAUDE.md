# CLAUDE.md

このファイルはClaude Code（claude.ai/code）がこのリポジトリでコードを扱う際のガイダンスを提供します。

## プロジェクト概要

Promptisは、プロンプト実行を半自動化することでGitHub Copilot Chatを拡張するVS Code拡張機能です。開発者がディレクトリに保存された事前定義されたプロンプトをソースコードファイルに対して実行し、一貫性のあるコードレビューと分析を可能にします。

## 開発コマンド

### ビルドと開発
- `npm run compile` - 拡張機能のコンパイル（OpenAPI生成、型チェック、linting、esbuildを含む）
- `npm run watch` - 開発用のウォッチモード（esbuildとTypeScriptコンパイラを並列実行）
- `npm run vscode:prepublish` - 拡張機能の公開準備

### テストと品質管理
- `npm test` - カバレッジ付きの完全なテストスイートを実行
- `npm run check-types` - ファイル出力なしでTypeScript型チェックを実行
- `npm run lint` - ソースコードのESLintとOpenAPI仕様の検証を実行
- `npm run pretest` - テストコンパイル、ソースコンパイル、lintingを実行する準備スクリプト

### 配布用ビルド
- `npm run build` - ライセンスレポートの作成とVSIXパッケージの作成
- `npm run build:vsix` - 配布用VSIXパッケージの作成

## アーキテクチャ

### コアコンポーネント

**拡張機能エントリーポイント (`src/extension.ts`)**
- "@promptis"用のVS Codeチャット参加者を有効化
- チャットハンドラーとコマンドを登録
- 参加者アイコンを設定

**チャットハンドラー (`src/chatHandler.ts`)**
- @promptisコマンドを処理するメインのリクエストプロセッサー
- `commandPromptDirectoryMap`を介してコマンドをプロンプトディレクトリにマッピング
- ターゲットファイル（#fileで指定）または選択されたエディタコンテンツを処理
- API呼び出しによるテレメトリをサポート

**設定 (`src/config.ts`)**
- プロンプトディレクトリパスのVS Code設定を管理
- プロンプトファイルの除外パターンを処理
- チャット出力とテレメトリ設定を構成

### コマンドとディレクトリのマッピング
拡張機能はスラッシュコマンドを設定パスにマッピングします：
- `/codereviewCodeStandards` → `codeReview.codeStandardPath`
- `/codereviewFunctional` → `codeReview.functionalPath`
- `/codereviewNonFunctional` → `codeReview.nonFunctionalPath`
- `/reverseEngineering` → `reverseEngineering.promptsPath`
- `/drawDiagrams` → `drawDiagrams.promptsPath`

### 処理フロー
1. ユーザーがコマンド付きで@promptisを呼び出し（例：`/codereviewCodeStandards`）
2. 拡張機能が設定から対応するプロンプトディレクトリを検索
3. そのディレクトリ内のすべての`.md`ファイルを検索（除外パターンを尊重）
4. チャットリクエストからターゲットファイルを抽出（#file、#dir、#filter変数）
5. 各ターゲットファイルとプロンプトの組み合わせについて、GitHub Copilotにコンテンツを送信
6. 結果をチャットインターフェースにストリーム
7. オプションで設定されたバックアップディレクトリにチャット出力を保存

### 主要機能
- **チャット変数**: 柔軟なファイルターゲティングのために#file、#dir、#filterをサポート
- **プロンプト除外**: 特定のプロンプトファイルを除外するためのminimatchパターンを使用
- **出力バックアップ**: タイムスタンプ付きでチャット会話をファイルに保存可能
- **テレメトリ**: 使用統計を収集（無効化可能）

### OpenAPI統合
- OpenAPI仕様（`openapi.yaml`）を使用してTypeScriptクライアントコードを生成
- APIクライアントはビルド時に`src/openapi/`ディレクトリに生成
- テレメトリ報告機能に使用

### ビルドシステム
- 高速なバンドリングとコンパイルにesbuildを使用
- 厳密な型チェック付きのTypeScriptコンパイル
- TypeScriptサポート付きコード品質のためのESLint
- htmlとjson-summary形式のカバレッジレポート
- 依存関係のライセンスチェック

## テスト
テストは`src/test/`にあり、5秒のタイムアウトでMochaフレームワークを使用します。拡張機能は`test-versions`スクリプトを介して複数のVS Codeバージョンでのテストをサポートします。
