import {strict as assert} from "node:assert";
import {renderDiz, renderReadme} from "../scripts/release-readme.mjs";

describe("release README and FILE_ID.DIZ", () => {
  it("renders start and checksum instructions for a sample release asset list", () => {
    const readme = renderReadme([
      "open-steamgate-0.1.42.vsix", "osd-linux-x64", "osd-darwin-arm64",
      "osd-windows-x64.exe", "sqlite.yml", "postgres.yml", "hana.yml",
    ]);
    assert.match(readme, /VS Code 1\.101 or newer/);
    assert.match(readme, /osd: Remove old working copies/);
    assert.match(readme, /chmod \+x osd && \.\/osd up/);
    assert.match(readme, /xattr -d com\.apple\.quarantine osd/);
    assert.match(readme, /osd\.exe doctor/);
    assert.match(readme, /self-contained Bun binary/);
    assert.match(readme, /osd up --layer <folder>/);
    assert.match(readme, /OSD_LAYERS/);
    assert.match(readme, /docker compose -f sqlite\.yml up -d/);
    assert.match(readme, /HANA_HOST.*HANA_USER.*HANA_PASSWORD/);
    assert.match(readme, /sha256sum -c/);
    assert.match(readme, /shasum -a 256 -c/);
    assert.match(readme, /Get-FileHash/);
    assert.doesNotMatch(readme, /duckdb\.yml/);
    assert.throws(() => renderReadme(["unexpected.txt"]), /unknown release asset/);
  });

  it("FILE_ID.DIZ stays within classic BBS byte and line limits", () => {
    const version = "0.1.1098";
    const bytes = renderDiz(version);
    const text = bytes.toString("ascii");
    assert.ok(text.includes(version));
    assert.match(text, /\.vsix/);
    assert.match(text, /binaries/);
    assert.match(text, /Compose/);
    assert.match(text, /  o O  _\|_____________________/);
    assert.match(text, /<\|=\|=\|    \|\|    \(o-o\)       \)/);
    assert.match(text, /\\\[_ooo_\]\//);
    assert.match(text, /\r\n$/);
    assert.equal(text.replaceAll("\r\n", "").includes("\n"), false);
    assert.equal(text.replaceAll("\r\n", "").includes("\r"), false);
    const lines = text.slice(0, -2).split("\r\n");
    assert.ok(lines.length <= 10);
    for (const line of lines) assert.ok(line.length <= 40);
    for (const line of lines.slice(-4)) assert.ok(line.length <= 31);
    for (const byte of bytes) assert.ok((byte >= 0x20 && byte <= 0x7e) || byte === 0x0d || byte === 0x0a);
    assert.throws(() => renderDiz("not-a-version"), /numeric release version/);
  });
});
