#!/bin/sh
# Optional local DIAG/RFC bridge. Run at the repository root after setup-local.sh.
set -eu
test -f docker/image/sources.json || { echo 'Run from open-steamgate repository root' >&2; exit 2; }
command -v go >/dev/null || { echo 'Go 1.26 is required for the local DIAG/RFC bridge' >&2; exit 2; }
command -v git >/dev/null || { echo 'Git is required for the local DIAG/RFC bridge' >&2; exit 2; }
base=.local/protocols
mkdir -p "$base" .local/bin
checkout() {
  folder="$1"; repo="$2"; ref="$3"
  target="$base/$folder"
  if [ ! -d "$target/.git" ]; then
    mkdir -p "$target"
    if [ -n "$(ls -A "$target")" ]; then
      echo "$target is not an empty Git checkout" >&2; exit 1
    fi
    git -C "$target" init --quiet
    git -C "$target" remote add origin "https://github.com/$repo.git"
  fi
  if ! git -C "$target" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$target" fetch --depth 1 origin "$ref"
    git -C "$target" checkout --detach FETCH_HEAD
  fi
  actual=$(git -C "$target" rev-parse HEAD)
  if [ "$actual" != "$ref" ]; then
    echo "$target is at $actual, expected $ref; existing checkout left intact" >&2
    exit 1
  fi
}
node -e 'for (const s of require("./docker/image/sources.json").protocols) console.log([s.folder,s.repo,s.ref].join(" "))' |
while read -r folder repo ref; do checkout "$folder" "$repo" "$ref"; done
go -C "$base/open-diag-go" build -o "$(pwd)/.local/bin/osd-up" ./cmd/osd-up
echo 'Ready: .local/bin/osd-up -instance 11 -attach http://127.0.0.1:8000 -stub tape'
