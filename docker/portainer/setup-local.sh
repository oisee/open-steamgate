#!/bin/sh
# Run from an open-steamgate checkout. Uses the same pins as tests.yml.
set -eu
checkout() {
  repo="$1"; revision="$2"; folder="$3"
  if [ ! -d "$folder/.git" ]; then
    mkdir -p "$folder"
    if [ -n "$(ls -A "$folder")" ]; then
      echo "Non-repository folder $folder is not empty; use a fresh directory/project" >&2; exit 1
    fi
    git -C "$folder" init
    git -C "$folder" remote add origin "https://github.com/oisee/$repo.git"
  fi
  if ! git -C "$folder" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$folder" fetch --depth 1 origin "$revision"
    git -C "$folder" checkout --detach FETCH_HEAD
  fi
  if [ "$(git -C "$folder" rev-parse HEAD)" != "$revision" ]; then
    echo "Expected $folder at $revision; existing checkout left intact" >&2
    exit 1
  fi
}
npm ci --include=dev --include=optional
checkout transpiler 0263e42892063be5008eab42a5f836bc19385b82 ../transpiler
npm --prefix ../transpiler install --ignore-scripts --no-audit --no-fund
for package in runtime transpiler extras cli; do
  npm --prefix "../transpiler/packages/$package" install --no-audit --no-fund
done
for package in runtime transpiler extras cli; do
  npm --prefix "../transpiler/packages/$package" run compile
done
chmod +x ../transpiler/packages/cli/abap_transpile
node tools/osd-link.mjs transpiler packages/transpiler
node tools/osd-link.mjs transpiler-cli packages/cli
node tools/osd-link.mjs runtime packages/runtime
checkout open-abap-core 52ba51a5662b93bd5093a9c1adef64bd438ce7f0 .local/lars/open-abap-core
checkout open-abap-gui 0324e1c1538f7ac63826ebbddab3fbee31c4501c .local/lars/open-abap-gui
node tools/osd-libs.mjs
npm run packs:fetch
npm run transpile
