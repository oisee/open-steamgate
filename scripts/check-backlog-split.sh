#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source_commit="$(node -p "JSON.parse(require('fs').readFileSync('docs/backlog/sections.json', 'utf8')).source")"
git show "${source_commit}:docs/backlog.md" | node scripts/check-backlog-split.mjs
