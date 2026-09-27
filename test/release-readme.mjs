import {strict as assert} from "node:assert";
import {test} from "node:test";
import {renderReadme} from "../scripts/release-readme.mjs";

test("renders start and checksum instructions for a sample release asset list", () => {
  const readme = renderReadme([
    "osd-vscode-0.1.42.vsix", "osd-linux-x64", "osd-darwin-arm64",
    "osd-windows-x64.exe", "sqlite.yml", "postgres.yml", "hana.yml",
  ]);
  assert.match(readme, /VS Code 1\.101 or newer/);
  assert.match(readme, /osd: Remove old working copies/);
  assert.match(readme, /chmod \+x osd && \.\/osd up/);
  assert.match(readme, /xattr -d com\.apple\.quarantine osd/);
  assert.match(readme, /osd\.exe doctor/);
  assert.match(readme, /docker compose -f sqlite\.yml up -d/);
  assert.match(readme, /HANA_HOST.*HANA_USER.*HANA_PASSWORD/);
  assert.match(readme, /sha256sum -c/);
  assert.match(readme, /shasum -a 256 -c/);
  assert.match(readme, /Get-FileHash/);
  assert.doesNotMatch(readme, /duckdb\.yml/);
  assert.throws(() => renderReadme(["unexpected.txt"]), /unknown release asset/);
});
