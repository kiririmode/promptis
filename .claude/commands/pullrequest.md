---
allowed-tools: Bash(gh repo view:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr edit:*), Bash(gh pr create:*), Bash(git rev-parse:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git push:*)
description: Generate PR description and automatically create pull request on GitHub
---

## コンテキスト

- リモートリポジトリのデフォルトブランチを確認: !`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
- 現在のブランチ: !`git rev-parse --abbrev-ref HEAD`
- 現在のgit状態: !`git status`
- このPRの変更: `git diff origin/[デフォルトブランチ名]...HEAD`
- このPRのコミット: `git log --oneline origin/[デフォルトブランチ名]..HEAD`

## タスク

以下の順で、PRのdescriptionを生成して、PRを作成してください。

1. まず、PRのテンプレートの内容を確認すること
   - .github/pull_request_template.mdがあればその内容を読むこと。なければ、PRの内容として以下とすること
     1. 前提（なぜこのPRが存在するのか）:「背景（背景要因）」と「課題（Problem）」を短く書く
     2. 目的（このPRが達成するゴール）: 背景と課題を踏まえたうえで、このPRで達成したい目的を明示する
     3. 変更内容（What）: レビュアーが迷いづらい書き方で「変えた事実」を列挙する。単にコードではなく、「どこがどう変わったか」というレベルで説明する。
     4. 変更のスコープ（どこまで含む／含まない）: このPRに含めた範囲、あえて含めなかった範囲
     5. 動作確認方法
     6. リスク・注意点: レビュアーが気づきづらい箇所を書いておく。
2. 現在のbranchに対応するPRが存在しているかを `gh pr list --head [現在のブランチ名]` と `gh pr view [PR番号]` を使って確認してください
3. すでにPRが存在していれば、`gh pr edit [PR番号] --body [PR description]` を使ってPRの内容を更新してください。存在していなければ、現在のbranchをpushし、 `gh pr create --title [タイトル] --body [PR description]` を使ってPRを作成してください。

### PR descriptionの内容

1. PRテンプレートの**正確な形式**に従って、日本語でPR説明を作成
2. PRのレビュアーに対して、認知負荷が低くなるように留意すること
3. このPRで行われた変更を視覚化する**Mermaid図**を追加

### 要件

1. テンプレートの構造に正確に従うこと
2. すべてのコンテンツを日本語で記述すること
3. 具体的な実装の詳細を含めること
4. 具体的なテスト手順をリスト化すること
5. 以下を示すMermaid図を必ず含めること:
   - アーキテクチャの変更（ある場合）
   - データフローの修正
   - コンポーネント間の関係
   - 変更によって影響を受けるプロセスフロー
6. 包括的かつ簡潔であること

### Mermaid図のガイドライン

- フローチャート、シーケンス図、クラス図など、変更内容に最も適した図のタイプを選択すること
- 該当する場合は変更前後の状態を、対応を比較しやすい形で示すこと
- 新規または修正されたコンポーネントをハイライトすること
- 一貫したスタイルと色を使用すること
- PR説明の専用セクションに図を追加すること
- mermaid図のラベルに日本語を含む場合は、その日本語部分は `"` で囲むこと
