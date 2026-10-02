// DSL L3: `dsl-l3 graph`, the set drawn from the compiled model
// (docs/dsl-l3.md, "The graph"). Both demo sets render, the output is
// byte-stable and follows the manifest's order, every node and edge traces to
// a set line that says what the node is, unknown flags are refused, and the
// diagram in the docs is the command's output.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileSet} from "../tools/dsl-l3.mjs";
import {docBlock, docDrift, graphJson, graphMermaid, graphOf} from "../tools/dsl-l3-graph.mjs";

const SETS = {fleet: "src/l2demo/fleet.l3.yaml", fleet2: "src/l2demo/fleet2.l3.yaml"};
const DOC = "docs/dsl-l3.md";
const cli = (...args) => spawnSync(process.execPath, ["tools/dsl-l3.mjs", "graph", ...args], {encoding: "utf8"});
const yamlLines = (file) => readFileSync(file, "utf8").split("\n");
const models = new Map();
const modelOf = (file) => { if (!models.has(file)) models.set(file, compileSet(file)); return models.get(file); };
const render = (model) => { const graph = graphOf(model); return {graph, mermaid: graphMermaid(graph), json: graphJson(graph)}; };
const draw = (file) => render(modelOf(file));

describe("dsl-l3 graph", function () {
  this.timeout(120000);
  describe("both sets render", () => {
    it("fleet2: two stages, a gate, a worklist, ports, and every setting block", () => {
      const {graph, mermaid} = draw(SETS.fleet2);
      expect(mermaid.startsWith("flowchart LR\n")).to.equal(true);
      const kinds = (k) => graph.nodes.filter((n) => n.kind === k);
      expect(kinds("stage").map((n) => n.label)).to.deep.equal(["stage 1: candidates (filter)", "stage 2: checks"]);
      expect(kinds("gate")).to.have.length(1);
      expect(kinds("rule")).to.have.length(6);
      expect(kinds("rule-filter")).to.have.length(1);
      expect(kinds("worklist").map((n) => n.label)).to.deep.equal(["worklist busy"]);
      expect(kinds("pile").map((n) => n.label)).to.deep.equal(["piles of 2\nsource: ships (ZOSD_L2_SHIP)", "piles of 2\nsource: worklist busy"]);
      for (const k of ["schedule", "resilience", "governor", "simulate"]) expect(kinds(k), k).to.have.length(1);
      expect(graph.groups.map((g) => g.label)).to.deep.equal(["stage 1: candidates (filter)", "stage 2: checks"]);
      const port = (name) => graph.nodes.find((n) => n.id === `set/fleet2/port/${name}`).label;
      expect(port("ships")).to.equal("ships (source ZOSD_L2_SHIP)\nbound: table\nother: capture, worklist");
      expect(port("close")).to.contain("bound: none\nother: capture, maintenance, sim");
      expect(kinds("governor")[0].label).to.contain("warn 70%, narrow at 80%");
      expect(kinds("simulate")[0].label).to.contain("seed 42, scale 0.01");
      expect(kinds("resilience")[0].label).to.contain("retry 2x, backoff 60 s");
      expect(kinds("schedule")[0].label).to.equal("schedule: every 1d at 020000");
      // the edges that make it a flow: the filter fills the worklist, the check stage's piles read it
      const edge = (from, to) => graph.edges.find((e) => e.from === from && e.to === to);
      expect(edge("set/fleet2/rule/ship-busy", "set/fleet2/stage/candidates/worklist").kind).to.equal("fill");
      expect(edge("set/fleet2/stage/candidates/worklist", "set/fleet2/stage/checks/piles").kind).to.equal("read");
      expect(edge("set/fleet2/stage/candidates/gate", "set/fleet2/stage/checks/head").kind).to.equal("gate");
      expect(edge("set/fleet2/governor", "set/fleet2/port/close").label).to.equal("autocloses via");
    });

    it("fleet: no stages, one subgraph of rules, the disabled rule apart, no gate", () => {
      const {graph} = draw(SETS.fleet);
      expect(graph.groups.map((g) => g.label)).to.deep.equal(["rules", "disabled rules"]);
      expect(graph.nodes.filter((n) => n.kind === "gate")).to.have.length(0);
      expect(graph.nodes.filter((n) => n.kind === "rule")).to.have.length(6);
      expect(graph.nodes.filter((n) => n.kind === "rule-disabled").map((n) => n.id)).to.deep.equal(["set/fleet/rule/ship-max-cargo"]);
      expect(graph.nodes.some((n) => ["schedule", "resilience", "governor", "simulate"].includes(n.kind))).to.equal(false);
    });

    it("every edge joins two nodes of the graph and every mermaid id is unique", () => {
      for (const file of Object.values(SETS)) {
        const {graph, mermaid} = draw(file);
        const ids = new Set(graph.nodes.map((n) => n.id));
        expect(ids.size).to.equal(graph.nodes.length);
        for (const e of graph.edges) { expect(ids.has(e.from), e.from).to.equal(true); expect(ids.has(e.to), e.to).to.equal(true); }
        const declared = [...mermaid.matchAll(/^ {2,4}(n_\w+)[\[\(>{]/gm)].map((m) => m[1]);
        expect(new Set(declared).size).to.equal(declared.length);
        expect(declared).to.have.length(graph.nodes.length);
      }
    });

    it("the CLI prints the same as the library, to stdout and to --out; --json is the same graph", () => {
      const dir = mkdtempSync(join(tmpdir(), "dsl-l3-graph-"));
      try {
        const {mermaid, json} = draw(SETS.fleet2);
        expect(cli(SETS.fleet2).stdout).to.equal(mermaid);
        expect(cli(SETS.fleet2, "--mermaid").stdout).to.equal(mermaid);
        expect(cli(SETS.fleet2, "--json").stdout).to.equal(json);
        const out = join(dir, "g.mmd");
        expect(cli(SETS.fleet2, "--mermaid", "--out", out).status).to.equal(0);
        expect(readFileSync(out, "utf8")).to.equal(mermaid);
        expect(JSON.parse(json).nodes.length).to.be.greaterThan(20);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });
  });

  describe("deterministic", () => {
    it("the same model gives byte-identical mermaid and JSON, five times over", () => {
      for (const file of Object.values(SETS)) {
        const first = draw(file);
        // a fresh compile of the same set, and the same model drawn again
        const fresh = compileSet(file);
        for (let i = 0; i < 4; i++) {
          const again = render(i % 2 ? fresh : modelOf(file));
          expect(again.mermaid).to.equal(first.mermaid);
          expect(again.json).to.equal(first.json);
        }
      }
    });

    it("the order is the manifest's: stages, rules and ports as the YAML lists them", () => {
      for (const file of Object.values(SETS)) {
        const model = modelOf(file);
        const {graph} = draw(file);
        const order = (kind) => graph.nodes.filter((n) => n.kind === kind || n.kind.startsWith(`${kind}-`)).map((n) => n.id);
        expect(order("port")).to.deep.equal(model.ports.map((p) => p["@id"]));
        expect(order("rule")).to.deep.equal(model.rules.concat(model.disabled).map((r) => r["@id"]));
        expect(graph.nodes.filter((n) => n.kind === "stage").map((n) => n.id)).to.deep.equal(model.stages ? model.stages.map((s) => `${s["@id"]}/head`) : [`${model.piles["@id"]}/head`]);
        // the nodes of a stage's subgraph are in the model's rule order
        for (const s of model.stages ?? []) {
          const g = graph.groups.find((x) => x.id === s["@id"]);
          expect(g.nodes.filter((id) => id.includes("/rule/"))).to.deep.equal(s.members.map((r) => r["@id"]));
        }
      }
    });

    it("the subgraphs come out in stage order in the mermaid text", () => {
      const {mermaid} = draw(SETS.fleet2);
      expect(mermaid.indexOf('"stage 1: candidates (filter)"]\n')).to.be.greaterThan(-1);
      expect(mermaid.indexOf("subgraph n_set_fleet2_stage_candidates")).to.be.lessThan(mermaid.indexOf("subgraph n_set_fleet2_stage_checks"));
      const rules = [...mermaid.matchAll(/^ {4}n_set_fleet2_rule_(\w+)\[/gm)].map((m) => m[1]);
      expect(rules).to.deep.equal(["ship_busy", "maintenance_ship_no_future_voyage", "grounded_ship_keeps_only_keepers",
        "ship_in_service_has_a_captain", "ship_too_many_future_voyages", "ship_min_crew", "ship_cargo_limit"]);
    });
  });

  describe("every node traces to a set line", () => {
    // what the line of a node must say, read off the YAML
    const SAYS = {
      set: /^set:/, stage: /^\s*- stage:|^piles:/, pile: /piles:/, worklist: /worklist:/, rule: /rule:/, "rule-filter": /rule:/, "rule-disabled": /rule:/,
      "port-source": /^\s+\w+:$/, "port-sink": /^\s+\w+:$/, "port-autoclose": /^\s+\w+:$/, "port-work": /^\s+\w+:$|^simulate:/,
      schedule: /^schedule:/, resilience: /^resilience:/, governor: /^governor:/, simulate: /^simulate:/,
    };
    for (const [name, file] of Object.entries(SETS)) {
      it(`${name}: nodes and edges carry a line of the set, and the line is what the node is`, () => {
        const lines = yamlLines(file);
        const {graph} = draw(file);
        for (const n of graph.nodes.concat(graph.edges)) {
          expect(Number.isInteger(n.line) && n.line >= 1 && n.line <= lines.length, `${n.id ?? `${n.from} -> ${n.to}`} line ${n.line}`).to.equal(true);
        }
        for (const n of graph.nodes) {
          const re = SAYS[n.kind];
          if (re) expect(lines[n.line - 1], `${n.id} at line ${n.line}`).to.match(re);
        }
        // a rule's line names its rule file, and the port's line names the port
        for (const n of graph.nodes.filter((x) => x.kind.startsWith("rule"))) expect(lines[n.line - 1]).to.contain(".l2.yaml");
        for (const n of graph.nodes.filter((x) => x.kind.startsWith("port-") && x.id.endsWith("/ships"))) expect(lines[n.line - 1].trim()).to.equal("ships:");
        expect(graph.groups.every((g) => Number.isInteger(g.line))).to.equal(true);
      });
    }

    it("the JSON of an edge names the line it comes from", () => {
      const json = JSON.parse(draw(SETS.fleet2).json);
      const lines = yamlLines(SETS.fleet2);
      const fill = json.edges.find((e) => e.kind === "fill");
      expect(lines[fill.line - 1]).to.contain("worklist: busy");
      const gate = json.edges.find((e) => e.kind === "gate");
      expect(lines[gate.line - 1]).to.contain("- stage: checks");
    });
  });

  describe("refusals", () => {
    it("unknown flags, other commands' flags, two formats and a missing set are refused", () => {
      for (const args of [["--bogus"], ["--ddic", "x"], ["--set", "x"], ["--db", "x"], ["--dot"], ["--mermaid", "--json"]]) {
        const r = cli(SETS.fleet, ...args);
        expect(r.status, args.join(" ")).to.equal(1);
        expect(r.stdout, args.join(" ")).to.equal("");
        expect(r.stderr, args.join(" ")).to.match(/unknown argument|one format/);
      }
      expect(cli().status).to.not.equal(0);
      expect(cli("src/l2demo/nothing.l3.yaml").status).to.equal(1);
    });
  });

  describe("the docs copy is the command's output", () => {
    it("the diagram of fleet2 in docs/dsl-l3.md equals what the command prints", () => {
      const {mermaid} = draw(SETS.fleet2);
      expect(docDrift(DOC, "fleet2", mermaid)).to.equal("");
      const r = cli(SETS.fleet2, "--docs", DOC);
      expect(r.status, r.stderr).to.equal(0);
      expect(r.stdout).to.contain("matches");
    });

    it("a changed diagram, a missing block and a stale copy are drift", () => {
      const dir = mkdtempSync(join(tmpdir(), "dsl-l3-graph-"));
      try {
        const {mermaid} = draw(SETS.fleet2);
        const doc = join(dir, "doc.md");
        writeFileSync(doc, `# x\n\n${docBlock("fleet2", mermaid)}\n`);
        expect(docDrift(doc, "fleet2", mermaid)).to.equal("");
        writeFileSync(doc, `# x\n\n${docBlock("fleet2", mermaid.replace("piles of 2", "piles of 3"))}\n`);
        expect(docDrift(doc, "fleet2", mermaid)).to.match(/differs from the command's output/);
        expect(cli(SETS.fleet2, "--docs", doc).status).to.equal(1);
        writeFileSync(doc, "# no block\n");
        expect(docDrift(doc, "fleet2", mermaid)).to.match(/no diagram block/);
        expect(cli(SETS.fleet2, "--json", "--docs", doc).status).to.equal(1);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });
  });
});
