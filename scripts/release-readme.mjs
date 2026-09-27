#!/usr/bin/env node
// A small start guide for the assets on this release. Render from the asset
// list so a release cannot describe a target it did not intend to upload.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const binaries = new Set(["osd-linux-x64", "osd-linux-arm64", "osd-darwin-arm64", "osd-windows-x64.exe"]);
const compose = new Set(["sqlite.yml", "duckdb.yml", "postgres.yml", "hana.yml"]);

export function renderReadme(assets) {
  const names = [...new Set(assets)];
  if (names.length === 0) throw new Error("pass at least one release asset");
  for (const name of names) {
    if (!/^osd-vscode-\d+\.\d+\.\d+\.vsix$/.test(name) && !binaries.has(name) && !compose.has(name)) {
      throw new Error(`unknown release asset: ${name}`);
    }
  }
  const lines = [
    "# Start here",
    "",
    "Pick the VSIX for VS Code, a Bun binary for a source checkout on your machine, or a Compose file for Docker. SQLite is the default Compose database.",
    "",
  ];
  for (const name of names) {
    lines.push(`## ${name}`, "");
    if (name.endsWith(".vsix")) {
      lines.push(
        "In VS Code 1.101 or newer, run **Extensions: Install from VSIX...** and select this file. Then run **osd: Start (build + run this system)** from the Command Palette. If asked whether to run an open-steamgate checkout, choose the bundled copy to use the packaged system. Its first start copies and builds the system; allow time for that build.",
        "",
        "The bundled working copy lives at `<globalStorageUri>/osd-home-<seedId>/`; the database lives under `<globalStorageUri>/osd-instance/<home-hash>/db/osd.sqlite`. VS Code owns the actual global storage path. After an update, run **osd: Remove old working copies** to review and remove stale bundled copies.",
        "",
      );
    } else if (binaries.has(name)) {
      if (name.endsWith(".exe")) {
        lines.push(
          "Download this file into a bootstrapped open-steamgate source checkout, rename it to `osd.exe`, and run `.\\osd.exe up` from the checkout in PowerShell. Run `.\\osd.exe doctor` to check the bundled runtime.",
          "",
        );
      } else {
        lines.push(
          `Download this file into a bootstrapped open-steamgate source checkout. Run \`mv ${name} osd && chmod +x osd && ./osd up\` from the checkout; run \`./osd doctor\` to check the bundled runtime.`,
          "",
        );
      }
      if (name === "osd-darwin-arm64") {
        lines.push("If macOS Gatekeeper quarantines the download, run `xattr -d com.apple.quarantine osd` after checking its checksum.", "");
      }
      lines.push(
        "Open `http://localhost:3030/`. The default SQLite database is `.local/db/osd.sqlite` under the directory where you start `osd`; a custom `STG_PORT` uses `.local/db/osd-<port>.sqlite`. The executable contains the host, while the checkout supplies system source, packs, and libraries (`npm run bootstrap` prepares them).",
        "",
      );
    } else {
      if (name === "postgres.yml") {
        lines.push("Set `POSTGRES_PASSWORD` in your environment, then run `docker compose -f postgres.yml up -d`. Open `http://localhost:3030/`. PostgreSQL rows live in the `pg-data` Docker volume.", "");
      } else if (name === "hana.yml") {
        lines.push("Set `HANA_HOST`, `HANA_USER`, and `HANA_PASSWORD` in your environment for an existing HANA tenant, then run `docker compose -f hana.yml up -d`. Open `http://localhost:3030/`. HANA data stays on the external tenant; `HANA_PORT` and `HANA_SCHEMA` are optional.", "");
      } else {
        lines.push(`Run \`docker compose -f ${name} up -d\`, then open \`http://localhost:3030/\`. ${name === "sqlite.yml" ? "SQLite rows" : "DuckDB rows"} live in the \`osd-data\` Docker volume.`, "");
      }
      lines.push("The file uses `ghcr.io/oisee/open-steamgate:draft` by default; set `OSD_TAG` to a tested Docker image tag to pin it.", "");
    }
  }
  const checksummed = names.filter((name) => name.endsWith(".vsix") || binaries.has(name));
  if (checksummed.length) {
    lines.push(
      "## Check downloads",
      "",
      "Each VSIX and Bun executable has a matching `<asset>.sha256` file. Download the file and its checksum into one directory. On Linux run `sha256sum -c <asset>.sha256`; on macOS run `shasum -a 256 -c <asset>.sha256`. On Windows run `Get-FileHash .\\<asset> -Algorithm SHA256` in PowerShell and compare its Hash with the first value in `<asset>.sha256` (`Get-Content .\\<asset>.sha256`).",
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(renderReadme(process.argv.slice(2))); }
  catch (error) { console.error(`release-readme: ${error.message}`); process.exitCode = 1; }
}
