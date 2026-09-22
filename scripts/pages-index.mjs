// Regenerate the gh-pages root after a preview is published or removed.
// The branch keeps one self-contained build in main/ and pr-<number>/; this
// index discovers what is really there, so old previews remain reachable and
// a closed one disappears without a hand-maintained list.
import {access, readdir, writeFile} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function previewDirectories(root) {
  const entries = await readdir(root, {withFileTypes: true});
  const candidates = entries
    .filter((entry) => entry.isDirectory() && (entry.name === "main" || /^pr-[1-9][0-9]*$/.test(entry.name)))
    .map((entry) => entry.name);
  const present = [];
  for (const name of candidates) {
    if (await exists(resolve(root, name, "app", "flp.html"))) present.push(name);
  }
  return present.sort((left, right) => {
    if (left === "main") return -1;
    if (right === "main") return 1;
    return Number(right.slice(3)) - Number(left.slice(3));
  });
}

export async function renderPreviewIndex(root) {
  const directories = await previewDirectories(root);
  const rows = [];
  for (const directory of directories) {
    const label = directory === "main" ? "main — current default branch" : `pull request #${directory.slice(3)}`;
    const shots = [];
    for (const [file, title] of [["list-report.png", "list report"], ["metadata.png", "metadata"], ["sadl-aggregate.png", "aggregate"]]) {
      if (await exists(resolve(root, directory, "screenshots", file))) {
        shots.push(`<a href="${directory}/screenshots/${file}">${title}</a>`);
      }
    }
    const screenshots = shots.length > 0 ? ` · screenshots: ${shots.join(", ")}` : "";
    rows.push(`      <li><a href="${directory}/app/flp.html">${label}</a>${screenshots}</li>`);
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>open-steamgate previews</title>
  <style>
    body { max-width: 52rem; margin: 3rem auto; padding: 0 1rem; font: 16px/1.5 system-ui, sans-serif; }
    h1 { line-height: 1.2; }
    li { margin: .55rem 0; }
    a { color: #0a6ed1; }
    code { background: #f3f3f3; padding: .1rem .3rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>open-steamgate previews</h1>
  <p>Each directory is a build that runs entirely in your browser: the OData gateway in a service worker, with the Fiori apps on top.</p>
  <p>The stable preview is <a href="main/app/flp.html"><code>main/app/flp.html</code></a>. Pull-request previews are retained while their PR is open.</p>
  <ul>
${rows.length > 0 ? rows.join("\n") : "      <li>No published previews yet.</li>"}
  </ul>
</body>
</html>
`;
}

async function main() {
  const root = resolve(process.argv[2] ?? ".");
  await writeFile(resolve(root, "index.html"), await renderPreviewIndex(root), "utf8");
  console.log(`Pages index: ${root}/index.html`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
