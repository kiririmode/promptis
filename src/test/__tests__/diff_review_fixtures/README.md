# Test Fixtures for `/codereviewDiff` Command

This directory contains test fixtures for automated testing of the `/codereviewDiff` command.

## Directory Structure

```
diff_review_fixtures/
├── prompts/
│   ├── file/                      # File-level review prompts (scope: file)
│   │   ├── typescript-review.md   # TypeScript review (*.ts, *.tsx)
│   │   ├── sql-review.md          # SQL review (*.sql)
│   │   ├── python-review.md       # Python review (*.py)
│   │   └── terraform-review.md    # Terraform review (*.tf)
│   └── changeset/                 # Changeset-level review prompts (scope: changeset)
│       ├── api-consistency.md     # API consistency check
│       └── schema-consistency.md  # Schema consistency check
└── README.md                      # This file
```

## Purpose

These test fixtures are used by the automated test suites to verify:

1. **File-level review prompts** - Prompts with `scope: file` that apply to specific file types via `applyTo` patterns
2. **Changeset-level review prompts** - Prompts with `scope: changeset` that review the entire changeset for cross-file consistency

## Usage

The test suites reference these fixtures when mocking the VS Code configuration for `codeReview.diffPath`. Tests verify that:

- Prompts are correctly filtered by scope (file vs. changeset)
- `applyTo` patterns correctly match file extensions
- The two-phase review pipeline executes in the correct order
- LLM interactions receive properly formatted prompts and diffs

## Note

These are **test fixtures only** and are not meant for production use. For actual usage, users should create their own prompts in a directory specified by the `codeReview.diffPath` setting.
