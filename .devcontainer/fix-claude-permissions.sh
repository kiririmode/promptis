#!/bin/bash
#
# Claude ディレクトリの権限チェックと修正
#
# macOS: fakeowner により自動的に正しい権限に見える
# WSL2: UID が一致していれば問題なし、一致していなければ修正
#

set -euo pipefail

CLAUDE_DIR="/home/node/.claude"

# .claude ディレクトリが存在しない場合は作成
if [ ! -d "${CLAUDE_DIR}" ]; then
    echo "Creating ${CLAUDE_DIR}..."
    mkdir -p "${CLAUDE_DIR}"
fi

# 現在の権限を確認
CURRENT_UID=$(stat -c '%u' "${CLAUDE_DIR}" 2>/dev/null || stat -f '%u' "${CLAUDE_DIR}" 2>/dev/null || echo "unknown")
CURRENT_GID=$(stat -c '%g' "${CLAUDE_DIR}" 2>/dev/null || stat -f '%g' "${CLAUDE_DIR}" 2>/dev/null || echo "unknown")
NODE_UID=$(id -u node)
NODE_GID=$(id -g node)

echo "Claude directory permissions check:"
echo "  Current UID:GID = ${CURRENT_UID}:${CURRENT_GID}"
echo "  Expected UID:GID = ${NODE_UID}:${NODE_GID}"

# 権限が一致していない場合は修正を試みる
if [ "${CURRENT_UID}" != "${NODE_UID}" ] || [ "${CURRENT_GID}" != "${NODE_GID}" ]; then
    echo "Permissions mismatch detected."

    # 書き込み権限のテスト
    if [ -w "${CLAUDE_DIR}" ]; then
        echo "Directory is writable (fakeowner may be active). No action needed."
    else
        echo "Attempting to fix permissions with sudo chown..."
        if sudo chown -R node:node "${CLAUDE_DIR}" 2>/dev/null; then
            echo "Permissions fixed successfully."
        else
            echo "WARNING: Failed to fix permissions."
            echo "This may cause issues with Claude Code."
            echo "Please manually run: sudo chown -R 1000:1000 ~/.claude"
        fi
    fi
else
    echo "Permissions are correct. No action needed."
fi

# 読み書きテスト
TEST_FILE="${CLAUDE_DIR}/.permission-test-$$"
if touch "${TEST_FILE}" 2>/dev/null; then
    rm -f "${TEST_FILE}"
    echo "Read/write test: PASSED"
else
    echo "Read/write test: FAILED"
    echo "Claude Code may not work correctly."
    exit 1
fi

echo "Claude directory setup complete."
