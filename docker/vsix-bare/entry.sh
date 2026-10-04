#!/bin/bash
set -euo pipefail
for tool in node npm git; do
  if command -v "$tool"; then echo "vsix-bare: unexpected $tool on PATH" >&2; exit 1; fi
done
echo 'vsix-bare: bare PATH confirmed (no node/npm/git)'
mkdir -p /smoke/user /smoke/extensions /smoke/workspace
dump_logs() {
  echo '--- VS Code output channels and osd logs ---'
  find /smoke -type f \( -name '*.log' -o -name '*osd*.txt' \) -print -exec tail -n 300 {} \;
}
finish() {
  result=$?
  if [ "$result" -ne 0 ]; then dump_logs; fi
  exit "$result"
}
trap finish EXIT
code_args=(--no-sandbox --disable-gpu --user-data-dir /smoke/user --extensions-dir /smoke/extensions)
timeout --kill-after=10s 180s code "${code_args[@]}" --install-extension /input/package.vsix --force
extension=$(find /smoke/extensions -mindepth 1 -maxdepth 1 -type d -name 'oisee.open-steamgate-*' -print -quit)
test -n "$extension"
export SMOKE_EXTENSION="$extension"
# VS Code assigns its API object by the requiring file's extension path.
# Put the harness beside the installed entry point so prompt/channel wrappers
# and the tested extension share that same API object.
cp /opt/smoke/harness.cjs "$extension/.bare-smoke-harness.cjs"
if [ -d /input/layer ]; then cp -a /input/layer/. /smoke/workspace/; fi
timeout --kill-after=10s 660s xvfb-run -a code "${code_args[@]}" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="$extension" --extensionTestsPath="$extension/.bare-smoke-harness.cjs" /smoke/workspace
# A successful Electron exit alone does not prove the tests ran.
test -s /smoke/PASS
cat /smoke/PASS
