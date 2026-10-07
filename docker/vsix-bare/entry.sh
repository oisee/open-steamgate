#!/bin/bash
set -euo pipefail
for tool in node npm git; do
  if command -v "$tool"; then echo "vsix-bare: unexpected $tool on PATH" >&2; exit 1; fi
done
echo 'vsix-bare: bare PATH confirmed (no node/npm/git)'
mkdir -p /smoke/user /smoke/extensions /smoke/workspace
dump_logs() {
  echo '--- VS Code logs (including extension host, renderer and output channels), stderr and osd logs ---'
  find /smoke -type f \( -path '/smoke/user/logs/*' -o -name '*.log' -o -name '*osd*.txt' \) -print -exec tail -n 300 {} \; || true
}
phase=installation
finish() {
  result=$?
  trap - EXIT
  echo "vsix-bare: $phase exit code $result"
  if [ "$result" -ne 0 ]; then dump_logs; fi
  exit "$result"
}
trap finish EXIT
code_args=(--no-sandbox --disable-gpu --user-data-dir /smoke/user --extensions-dir /smoke/extensions)
timeout --kill-after=10s 180s code "${code_args[@]}" --install-extension /input/package.vsix --force 2>&1 | tee /smoke/install.log
extension=$(find /smoke/extensions -mindepth 1 -maxdepth 1 -type d -name 'oisee.open-steamgate-*' -print -quit)
test -n "$extension"
export SMOKE_EXTENSION="$extension"
# VS Code assigns its API object by the requiring file's extension path.
# Put the harness beside the installed entry point so prompt/channel wrappers
# and the tested extension share that same API object.
cp /opt/smoke/harness.cjs "$extension/.bare-smoke-harness.cjs"
if [ -d /input/layer ]; then cp -a /input/layer/. /smoke/workspace/; fi
phase='VS Code test process'
# bin/code is a fire-and-forget CLI: it detaches Electron and discards its
# stderr. Run Electron itself so Xvfb and the deadline last until tests finish,
# and pipefail preserves its real exit status through tee.
unset ELECTRON_RUN_AS_NODE
export ELECTRON_ENABLE_LOGGING=1
timeout --kill-after=10s 660s xvfb-run -a -e /smoke/xvfb.log /opt/code/code "${code_args[@]}" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="$extension" --extensionTestsPath="$extension/.bare-smoke-harness.cjs" /smoke/workspace \
  2>&1 | tee /smoke/code.log
echo 'vsix-bare: VS Code test process exit code 0'
# A successful Electron exit alone does not prove the tests ran.
phase='PASS marker check'
if [ ! -s /smoke/PASS ]; then echo 'vsix-bare: VS Code exited without the harness PASS marker' >&2; exit 1; fi
cat /smoke/PASS
