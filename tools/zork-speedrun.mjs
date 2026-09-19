// Zork as an end-to-end test of a host (SP4's control group).
//
// One WebSocket to the push channel, a script of commands and expectations,
// and a verdict. It exercises what nothing else here does in one go: the APC
// upgrade through the façade to the serving child, a stateful ABAP handler
// that keeps a session, the Z-machine interpreter transpiled from ABAP, and
// the story file loaded out of SMW0 — so if a host is wrong about sockets,
// state, media or numbers, this says so in plain English.
//
//   node tools/zork-speedrun.mjs http://127.0.0.1:3099 [script.txt]
//
// The script is the one the preview e2e uses (upper case commands are the
// game's, `%*text*` expects the output to contain text, `%!text` expects it
// not to, `%=text` is case-sensitive, `#` is a comment).
import {readFileSync} from "node:fs";
import {runsAs} from "./osd-main.mjs";

const DEFAULT_SCRIPT = ".local/cpm-abap/test-games/MINIZORK_TEST.TXT";
const CHANNEL = "/sap/bc/apc/sap/zapc_zork";

export function parseScript(text) {
  const steps = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("%")) {
      const body = line.slice(1);
      if (body.startsWith("!")) {
        steps.push({expect: body.slice(1).replace(/^\*|\*$/g, ""), absent: true});
      } else if (body.startsWith("=")) {
        steps.push({expect: body.slice(1), exact: true});
      } else {
        steps.push({expect: body.replace(/^\*|\*$/g, "")});
      }
    } else {
      steps.push({send: line});
    }
  }
  return steps;
}

const matches = (text, step) => (step.exact ? text.includes(step.expect) : text.toLowerCase().includes(step.expect.toLowerCase()));

export async function speedrun(base, script, options = {}) {
  const quiet = options.quiet === true;
  const url = base.replace(/^http/, "ws") + CHANNEL;
  const socket = new WebSocket(url);
  let buffer = "";
  const idle = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async (ms = options.settle ?? 900) => {
    let seen;
    do {
      seen = buffer.length;
      await idle(ms);
    } while (buffer.length !== seen);
  };
  socket.addEventListener("message", (e) => { buffer += typeof e.data === "string" ? e.data : ""; });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error(`the channel did not open: ${url}`)));
    setTimeout(() => reject(new Error(`the channel did not open within 20 s: ${url}`)), 20000);
  });
  const failures = [];
  let checks = 0;
  let sent = 0;
  const started = Date.now();
  try {
    await settle();
    for (const step of script) {
      if (step.send !== undefined) {
        buffer = "";
        socket.send(step.send + "\r");
        sent++;
        await settle();
        continue;
      }
      checks++;
      const hit = matches(buffer, step);
      if (hit === (step.absent === true)) {
        failures.push({expect: step.expect, absent: step.absent === true, saw: buffer.replace(/\s+/g, " ").trim().slice(0, 160)});
        if (!quiet) {
          console.log(`  MISS ${step.absent ? "not " : ""}${JSON.stringify(step.expect)} — saw: ${failures.at(-1).saw}`);
        }
      }
    }
  } finally {
    socket.close();
  }
  return {commands: sent, checks, failures, ms: Date.now() - started};
}

if (runsAs("zork-speedrun.mjs")) {
  const base = process.argv[2] ?? "http://127.0.0.1:3030";
  const file = process.argv[3] ?? DEFAULT_SCRIPT;
  const script = parseScript(readFileSync(file, "utf8"));
  const result = await speedrun(base, script);
  console.log(`${base}: ${result.commands} commands, ${result.checks} checks, ${result.failures.length} failed, ${result.ms} ms`);
  process.exit(result.failures.length === 0 ? 0 : 1);
}
