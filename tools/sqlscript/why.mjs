// Show the bodies behind one line of the coverage histogram.
//
//   node tools/sqlscript/why.mjs "at ="  [--n 3] [--root .local/a4h-export]
//
// The histogram names a token and a count; a token is not a construct. Three
// times now the top entry has meant something other than what its name
// suggested -- `BEGIN` was an artefact of reporting the wrong position, `*`
// was ABAP's comment and not multiplication, and `"` was a quoted identifier
// rather than a comment -- and every time the correction came from reading a
// body rather than from reasoning about the name. So the loop is: measure,
// then LOOK at one of the things measured, then write grammar. This is the
// looking step, and it exists as a tool because doing it by hand is exactly
// the step a tired session skips.
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {lex, LexError} from "./lexer.mjs";
import {parse, ParseError} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {bodiesOf, classesIn, reasonOf} from "./coverage.mjs";

const TEACHING = /^(SABAPDEMOS|SABAP_DEMOS_|SABP_COMPILER|SABP_UNIT_DOUBLE_|SDDIC_ADT_TEST|SACMTST|S_ESH_TST_AUTOMATION|BW4_PREVIEW_TEST)/;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const wanted = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (wanted === undefined) {
  console.error('usage: node tools/sqlscript/why.mjs "at =" [--n 3] [--root .local/a4h-export] [--context 6]');
  process.exit(2);
}
const root = flag("root", ".local/a4h-export");
const want = Number(flag("n", 3));
const context = Number(flag("context", 6));

let shown = 0;
// The same class is exported in more than one package, and a class has more
// than one method: without this the first three hits were one body printed
// three times, which looks like evidence and is not.
const seen = new Set();
outer:
for (const zip of readdirSync(root).filter((f) => f.endsWith(".zip"))) {
  const pkg = zip.replace(/\.zip$/, "");
  if (TEACHING.test(pkg)) continue;  // the working corpus is what decides
  for (const file of classesIn(join(root, zip), join("/tmp/sqlscript-coverage", pkg))) {
    for (const {body} of bodiesOf(readFileSync(file, "utf8"), file.split("/").pop())) {
      let tokens = [];
      try {
        tokens = lex(body);
        parse(new Body(), tokens);
        continue;                                   // it goes through; not our case
      } catch (error) {
        if (!(error instanceof ParseError) && !(error instanceof LexError)) continue;
        if (!reasonOf(error, tokens).includes(wanted)) continue;
        const key = `${file.split("/").slice(-1)[0]}:${error.line}:${error.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lines = body.split("\n");
        const at = error.line ?? 1;
        console.log(`\n=== ${file.split("/").slice(-1)[0]}  line ${at}, col ${error.col ?? "?"}  (${reasonOf(error, tokens)})`);
        for (let i = Math.max(1, at - context); i <= Math.min(lines.length, at + context); i += 1) {
          console.log(`${i === at ? ">" : " "} ${String(i).padStart(4)}  ${lines[i - 1]}`);
        }
        shown += 1;
        if (shown >= want) break outer;
      }
    }
  }
}
if (shown === 0) console.log(`no body in the working corpus stops at ${JSON.stringify(wanted)}`);
