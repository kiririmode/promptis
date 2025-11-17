#!/bin/bash
set -e

# Verify direnv is installed
if ! command -v direnv &> /dev/null; then
    echo "direnv not found in PATH"
    exit 1
fi

# Create .envrc in home directory if it does not exist
if [ ! -f ~/.envrc ]; then
    touch ~/.envrc
fi

# Auto-allow .envrc files
direnv allow ~/.envrc

# Auto-allow project .envrc if it exists
if [ -f /workspaces/claude-plugins/.envrc ]; then
    direnv allow /workspaces/claude-plugins/.envrc
fi

# Initialize direnv in bash for all future shells
# shellcheck disable=SC2016
if ! grep -q 'eval "$(direnv hook bash)"' ~/.bashrc; then
    # shellcheck disable=SC2016
    echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
fi

# Load environment variables
eval "$(direnv export bash)"

echo "direnv bash hook initialization complete"
