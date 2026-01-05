---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(git symbolic-ref:*), Bash(git checkout:*)
description: Analyze changes and create commits in Conventional Commits format, split into logical units
---

このコマンドは現在の変更を分析し、論理的な単位に分割して日本語のコミットメッセージを生成する。

# コンテキスト

- 現在のgit status: !`git status`
- 現在のgit diff (ステージ済みと未ステージの変更): !`git diff HEAD`
- 現在のブランチ: !`git branch --show-current`
- リモートのデフォルトブランチ: !`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`
- 最近のコミットスタイルの確認: !`git log --oneline -5`

## 実行手順

1. **デフォルトブランチの場合はfeature branchを作成する**

   - デフォルトブランチ上にいる場合は、conventional branchのルールに従って、branchを作成する
   - ブランチ仕様は以下のプレフィックスをサポートし、次のように構造化される。
     - `<type>/<description>`
     - `feature/`: 新機能用 (例: feature/add-login-page, feat/add-login-page)
     - `fix/`: バグ修正用 (例: fix/fix-header-bug, fix/header-bug)
     - `hotfix/`: 緊急修正用 (例: hotfix/security-patch)
     - `release/`: リリース準備用 (例: release/v1.2.0)
     - `chore/`: 依存関係更新やドキュメント更新などの非コードタスク用 (例: chore/update-dependencies)

2. **変更の分類と Conventional Commits タイプの決定**

   変更を以下のような論理的な単位に分類し、変更内容に対応するConventional Commitsタイプを選択してください:

   - feat - 機能追加（新しい機能の実装）
   - fix - バグ修正（既存機能の不具合修正）
   - refactor - リファクタリング（動作を変えずにコードを改善）
   - docs - ドキュメント更新（README、コメント、docstring等）
   - test - テスト追加/修正
   - chore - 設定変更（CI/CD、開発環境、ビルドプロセス等）
   - perf - パフォーマンス改善
   - style - コードスタイルの修正（フォーマット、空白等）
   - build - ビルドシステムや外部依存関係の変更
   - ci - CI設定ファイルやスクリプトの変更

3. **コミットメッセージの生成（Conventional Commits 形式）**

   各論理的な単位について、以下の形式で日本語のConventional Commitsメッセージを作成してください。
   何をしたのかよりも、なぜその変更を必要としたのかという点を記載してください。
   それが差分から読み取れない場合は、`AskUserQuestion` ツールを使ってユーザに問い合わせてください。

   ```text
   <type>: <日本語の概要>

   <日本語の詳細説明>
   - なぜこの変更が必要だったのか
   - どのように問題を解決したのか
   - 関連する背景や制約があれば記載
   ```

   **形式の例:**

   ```text
   feat: バッチ処理機能を追加

   複数のVTTファイルから一つひとつ議事録を作成するのがユーザとして面倒だったため、
   複数のVTTファイルを一括処理できる機能を実装した。
   - ディレクトリ内の全VTTファイルを自動検出
   - 並列処理によるパフォーマンス向上
   - エラー時の詳細なログ出力を追加
   ```

   ```text
   fix: ファイル上書き時の確認処理を修正

   出力ファイルが既存の場合、確認なしで上書きされる不具合を修正。
   --overwrite オプションを追加し、明示的な指定を必要とするようにした。
   ```

   **重要な制約事項:**
   - typeは英語、説明は日本語で記述すること
   - 絵文字を使用しないこと
   - 破壊的変更がある場合は、BREAKING CHANGE: セクションを追加すること

4. **コミットの実行**

   各論理的な単位について:

   a. 該当するファイルを `git add` でステージング
   b. 生成したメッセージで `git commit` を実行（HEREDOCを使用）

   コミット実行例:

   ```bash
   git add file1.py file2.py
   git commit -m "$(cat <<'EOF'
   feat: バッチ処理機能を追加

   複数のVTTファイルを一括処理できる機能を実装した。
   - ディレクトリ内の全VTTファイルを自動検出
   - 並列処理によるパフォーマンス向上
   EOF
   )"
   ```

5. **最終確認**

   すべてのコミットが完了したら:

   - `git log --oneline -5` で作成したコミットを表示
   - コミット内容をユーザーに報告

## 注意事項

- ステージング済みの変更がある場合は、それらも含めて分析してください
- 変更が論理的に1つの単位にまとまっている場合は、分割せずに1つのコミットを作成してください
- 複数の独立した変更が混在している場合のみ、複数のコミットに分割してください
- コミット前にpre-commitフックが実行される場合、フックが変更を加えた場合はその変更をgit addで取り込んでください。
- コミット作成後、pushは実行しません（ユーザーが明示的に指示した場合のみ）

## エラー処理

- コミットが失敗した場合はエラー内容を確認しユーザーに報告する
- 未追跡ファイルで .envやcredentials.jsonなどの秘密情報を含む可能性があるファイルはコミットせずユーザーに警告する

すべての作業を日本語でユーザーに報告してください。
