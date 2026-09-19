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
import {toIr} from "./to-ir.mjs";
import {lower} from "../sqlscript-lower.mjs";

const TEACHING = /^(SABAPDEMOS|SABAP_DEMOS_|SABP_COMPILER|SABP_UNIT_DOUBLE_|SDDIC_ADT_TEST|SACMTST|S_ESH_TST_AUTOMATION|BW4_PREVIEW_TEST)/;

// The coverage report prints **two** histograms -- one for bodies the
// grammar stopped, one for bodies it read and the lowering then refused --
// and this tool only ever spoke for the first. That made the looking step
// available for exactly half the questions, and the half it could not answer
// is the one that moves the number that counts. So a body is put through
// both stages here, and a line from either histogram is a thing you can ask
// about by the same command.
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
    for (const {body, signature, language} of bodiesOf(readFileSync(file, "utf8"), file.split("/").pop())) {
      // the same pipeline `coverage.mjs` measures, argument for argument.
      // It was not: this passed `signature: undefined` and skipped no
      // language, so it could report a refusal the measurement never had --
      // an explaining tool that reproduces a different program explains
      // something else, convincingly.
      if (language !== "SQLSCRIPT") continue;
      let tokens = [];
      let tree;
      let why;
      let at = 1;
      let col;
      try {
        tokens = lex(body);
        tree = parse(new Body(), tokens);
      } catch (error) {
        if (!(error instanceof ParseError) && !(error instanceof LexError)) continue;
        why = reasonOf(error, tokens);
        at = error.line ?? 1;
        col = error.col;
      }
      if (tree !== undefined) {
        // it went through the grammar; the lowering is the other half of the
        // question, and its message is the line of the second histogram
        try {
          const ir = toIr(tree, {catalogue: {}, signature});
          lower(ir.rel, "hana");
          continue;                                 // it goes through whole
        } catch (error) {
          why = String(error.message ?? error).replace(/: line.*/, "").slice(0, 60);
          at = Number(/line (\d+)/.exec(String(error.message ?? ""))?.[1] ?? 1);
        }
      }
      if (!why.includes(wanted)) continue;
      const key = `${file.split("/").slice(-1)[0]}:${at}:${col ?? "-"}:${why}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lines = body.split("\n");
      console.log(`\n=== ${file.split("/").slice(-1)[0]}  line ${at}, col ${col ?? "?"}  (${why})`);
      for (let i = Math.max(1, at - context); i <= Math.min(lines.length, at + context); i += 1) {
        console.log(`${i === at ? ">" : " "} ${String(i).padStart(4)}  ${lines[i - 1]}`);
      }
      shown += 1;
      if (shown >= want) break outer;
    }
  }
}
if (shown === 0) console.log(`no body in the working corpus stops at ${JSON.stringify(wanted)}`);
