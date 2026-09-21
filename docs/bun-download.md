# Bun SQLite download bundles (private test draft)

This draft packages one Bun executable (`osd`/`osd.exe`), the Go DIAG/RFC bridge
(`osd-up`/`osd-up.exe`), a prebuilt OSD generation and the LSD, ZO4D and
Mini-Zork packs. No Node, Go, Bun or Docker installation is needed to run it.
Extract the archive once; `run.sh` or `run.ps1` starts both executables. The
launcher does not self-extract the archive. It keeps SQLite data outside the
extracted tree so replacing the tree does not delete the database.

The four targets are Linux x86-64 baseline, Linux arm64, Windows x64 baseline,
and macOS arm64. From a prepared checkout, one command verifies/pins the Go
sources, runs the ABAP build and unit tests, builds all eight executables,
assembles four archives, checks SHA-256, and smoke-tests the host's native
Unix bundle (including an OData write across restart):

```sh
node scripts/release/build-all.mjs
```

Use `--no-native-smoke` only when local port binding is unavailable. Remote
targets still need native smoke tests on their own machines; cross-compiling
alone cannot attest that they run.

On Linux/macOS, extract the `.tar.gz`, enter its directory and run `./run.sh`.
On Windows, use Extract All on the `.zip`, enter the extracted directory and
run `powershell -ExecutionPolicy Bypass -File .\run.ps1`. Set `INSTANCE=11`
(or another two-digit number) before launch to select HTTP `80nn`, DIAG `32nn`
and RFC `33nn`; the default is 11. TLS is disabled by default. The Unix data
directory defaults to `${XDG_DATA_HOME:-$HOME/.local/share}/open-steamgate`;
the Windows data directory defaults to `%LOCALAPPDATA%\open-steamgate`. Use
`OSD_DATA_DIR` to override it. Do not launch two bundles against the same
SQLite file at once.

Private-test status is intentional. The [Z-Machine Standards Document](https://www.inform-fiction.org/zmachine/standards/z1point1/appf.html)
describes Mini-Zork as public domain, but this is not the MIT grant for the
full Zork I–III source. Complete transitive dependency notices and binary
provenance need review before a public GitHub release. The archives carry
`release.json`, SHA-256 checksum files, the project license, and direct
protocol-source license notices. The macOS binary is not signed or notarized.
