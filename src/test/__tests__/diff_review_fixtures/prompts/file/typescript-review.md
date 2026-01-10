---
scope: file
applyTo:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript差分レビュー

以下の観点でレビューしてください:

1. **型安全性**: any型の使用、型アサーションの妥当性
2. **非同期処理**: Promise、async/awaitの適切な使用
3. **エラーハンドリング**: try-catchの配置、エラー型の定義
