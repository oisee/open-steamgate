// One command: a SEGW project in, a running OData service and a Fiori app out.
//
//   npm run example                        the shipped demo
//   npm run example -- <file.stg.yaml>     a service described as one YAML
//   npm run example -- <file.iwpr.xml>     a project tree exported from SEGW
//   npm run example -- --check             the same, but exit once it is proven
//
// Why this exists. Everything below it already worked -- stg-compile, segw-gen,
// the registry, the dispatcher, the launchpad -- but a stranger had to know
// which four commands to run in which order and then guess the URLs. A demo
// nobody can start is a demo nobody has seen.
//
// The rule this tool is built on, and the reason it is slower than printing a
// list: **it does not print a URL it has not read.** Every address below is
// fetched and its body checked for something only the right answer contains,
// so "here is your service" cannot be a link to a 404 or to somebody else's
// server on the same port. That last one is not hypothetical -- a check
// against the usual port has passed here against a deployment that had
// nothing to do with the build under test.
import {spawn} from "node:child_process";
import {readFileSync, existsSync, readdirSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {runsAs} from "./osd-main.mjs";

const DEMO = "src/demo/zstg_demo.stg.yaml";

/** What we will say about one address once it has answered. */
const checks = (port, service, set) => [
  {what: "the service document",
   url: `http://localhost:${port}/sap/opu/odata/sap/${service}/`,
   wants: (b) => b.includes(set), why: `names ${set}`},
  {what: "$metadata",
   url: `http://localhost:${port}/sap/opu/odata/sap/${service}/$metadata`,
   wants: (b) => b.includes("EntityType") && b.includes(set), why: "carries the entity types"},
  {what: "the entity set",
   url: `http://localhost:${port}/sap/opu/odata/sap/${service}/${set}?$top=1&$format=json`,
   wants: (b) => b.includes("\"d\""), why: "answers rows as OData JSON"},
  {what: "the launchpad",
   url: `http://localhost:${port}/app/flp.html`,
   wants: (b) => b.toLowerCase().includes("<html"), why: "is a page"},
];

/** A file already under `src/` is already part of the tree, and the build
 *  compiles it itself (`stg-compile --all`). Compiling it a second time into
 *  `gen/example/` puts the same objects in `gen/` twice, and the builder
 *  refuses the whole build -- correctly, because no layer order decides
 *  between two copies of one name. Found by running this tool: the first
 *  full run died on ZCL_ZSTG_DEMO_MPC_ANN in gen/example and gen/stg at
 *  once. So the rule is: the tree compiles what belongs to the tree, and
 *  this tool compiles only what a stranger brought with them. */
export const inTree = (input) => /^(\.\/)?src\//.test(input.replace(/^.*?open-steamgate\//, ""));

/** Compile the input into `gen/example/`, and report what came out by READING
 *  the generated folder rather than by trusting the generator's exit code. */
export async function compile(input, out) {
  const isTree = input.endsWith(".iwpr.xml");
  const tool = isTree ? "tools/segw-gen.mjs" : "tools/stg-compile.mjs";
  const args = isTree
    ? [tool, input.replace(/\/[^/]+$/, ""), "--out", out]
    : [tool, input, "--out", out];
  const code = await run(process.execPath, args);
  if (code !== 0) throw new Error(`${tool} exited ${code}`);
  if (!existsSync(out)) throw new Error(`${tool} exited 0 and wrote no ${out} -- nothing to serve`);
  return readdirSync(out);
}

/** The service name, from the IWSV. That one IS in the file: a fixed XML tag
 *  with the name in it, and it is what the dispatcher registers.
 *
 *  The entity sets are NOT read here, and the reason is worth keeping. The
 *  first version scraped `create_entity_set( 'XSet' )` out of the MPC source
 *  and worked beautifully on the generated class -- then returned nothing at
 *  all for the hand-written one, because a developer writes
 *  `create_entity_set( gc_photo_set )` with a constant. Reading a program to
 *  learn what it will do is a heuristic; asking the running service is an
 *  answer. So the sets come from `$metadata`, which is also exactly what any
 *  client would do.
 */
export function serviceOf(dir, files) {
  const iwsv = files.find((f) => f.endsWith(".iwsv.xml"));
  if (iwsv === undefined) throw new Error(`no *.iwsv.xml in ${dir}: nothing would be registered`);
  const xml = readFileSync(join(dir, iwsv), "utf8");
  return {service: /<TECHNICAL_NAME>([^<]+)</.exec(xml)?.[1]
    ?? basename(iwsv).split(".")[0].toUpperCase()};
}

/** Every entity set the service says it has, out of its own $metadata. */
export const setsOf = (metadata) =>
  [...metadata.matchAll(/<EntitySet\s[^>]*Name="([^"]+)"/gi)].map((m) => m[1]);

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, {stdio: "inherit", ...opts});
  p.on("exit", (c) => resolve(c ?? 1));
});

/** Poll until the address answers what it is supposed to answer, or give up
 *  and say which address and what came back instead of a timeout with no noun
 *  in it. */
async function until(url, wants, deadlineMs) {
  const end = Date.now() + deadlineMs;
  let last = "nothing at all";
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      const body = await r.text();
      if (r.ok && wants(body)) return body;
      last = `HTTP ${r.status}, ${body.length} bytes`;
    } catch (e) {
      last = String(e?.cause?.code ?? e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never answered as expected (last: ${last})`);
}

export async function main(argv) {
  const input = argv.find((a) => !a.startsWith("--")) ?? DEMO;
  if (!existsSync(input)) {
    console.error(`no such file: ${input}`);
    return 2;
  }
  const port = Number(process.env.STG_PORT ?? 3030);
  const out = "gen/example";
  let set;

  const mine = !inTree(input);
  console.log(`\n1/3  ${mine ? `compiling ${input}` : `${input} is already part of the tree`}`);
  // For a file in the tree the objects sit beside it -- `src/demo/` holds the
  // YAML, the IWSV/IWMO and the hand-written classes together. They are NOT in
  // gen/stg/: stg-compile skips a YAML whose objects src/ already holds, which
  // is exactly this case and which cost one confident wrong guess to learn.
  const dir = mine ? out : dirname(input);
  const files = mine ? await compile(input, out) : readdirSync(dir);
  const {service} = serviceOf(dir, files);
  console.log(`     ${files.length} files in ${dir}/${mine ? "" : ", already in the tree"}`);
  console.log(`     service ${service}`);

  console.log(`\n2/3  starting the server on :${port} (first run transpiles, which is slow)`);
  // `detached` so the child gets its own process group, and the stop below
  // signals the GROUP. `npm start` is a shell that spawns node; killing only
  // npm leaves node holding the port, and the next run of this tool dies with
  // EADDRINUSE on a server it started itself. Measured exactly that way.
  const server = spawn("npm", ["start"], {stdio: ["ignore", "inherit", "inherit"], detached: true});
  const stop = () => {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  };
  process.on("SIGINT", () => { stop(); process.exit(130); });

  try {
    console.log(`\n3/3  reading each address before printing it`);
    const base = `http://localhost:${port}/sap/opu/odata/sap/${service}`;
    const metadata = await until(`${base}/$metadata`, (b) => b.includes("EntityType"), 300000);
    const sets = setsOf(metadata);
    console.log(`     ok   $metadata: ${sets.length} entity sets \u2014 ${sets.join(", ")}`);
    if (sets.length === 0) throw new Error(`${service} publishes no entity set: nothing to fetch`);
    set = sets[0];
    for (const c of checks(port, service, set)) {
      if (c.what === "$metadata") continue;
      await until(c.url, c.wants, 120000);
      console.log(`     ok   ${c.what}: ${c.why}`);
    }
  } catch (e) {
    console.error(`\n     ${e.message}`);
    console.error(`     Not printing addresses that did not answer -- a link that 404s is worse`);
    console.error(`     than no link. The server's own output is above.`);
    stop();
    return 1;
  }

  console.log(`\nServing ${service}. Every address below was fetched and read just now:\n`);
  for (const c of checks(port, service, set)) console.log(`  ${c.url}`);
  if (argv.includes("--check")) {                    // for a suite: prove it, then go
    stop();
    return 0;
  }
  console.log(`\nThe server is still running in this terminal; ctrl-c stops it.`);
  await new Promise(() => {});                       // hand the terminal to the server
  return 0;
}

if (runsAs("osd-example.mjs")) process.exit(await main(process.argv.slice(2)));
