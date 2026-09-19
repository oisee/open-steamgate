// Every object a hand-written file holds out of the generator, compared.
//
// `stg-compile --all` prints "N held by src/, not compared" per service, and
// that line used to say "kept", which reads as a convenience. It is not one:
// it is the list of places where two versions of one object exist and
// nothing arbitrates between them. Measured 2026-09-19: **18 objects across
// three services**, and the model saying `Text` while the class said
// `status_text` was one of the eighteen, undetected for months.
//
// The list is taken from the pass itself rather than written here, so a
// fourth service with a hand-written twin is covered the day it appears --
// a list of a closure is the thing this project keeps getting wrong.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {compileAll} from "../tools/stg-compile.mjs";

/** `TYPES: BEGIN OF x … END OF x` as {name: [fields]}, plus table types. */
export function typesOf(src) {
  const out = {};
  for (const m of src.matchAll(/TYPES:?\s*BEGIN OF\s+([a-z0-9_]+)\s*,?([\s\S]*?)END OF\s+\1/gi)) {
    out[m[1].toLowerCase()] = [...m[2].matchAll(/^\s*([a-z0-9_]+)\s+TYPE\s/gim)].map((x) => x[1].toLowerCase());
  }
  for (const m of src.matchAll(/TYPES:?\s*([a-z0-9_]+)\s+TYPE\s+STANDARD TABLE OF\s+([a-z0-9_]+)/gi)) {
    out[m[1].toLowerCase()] = [`TABLE OF ${m[2].toLowerCase()}`];
  }
  return out;
}

// One entry per object that differs, with the reason and what closes it.
// An exception with a reason can be told from a way of making the build
// green; a bare allow-list cannot.
const KNOWN = {
  "zcl_zstg_demo_mpc.clas.abap": {
    ts_text_element: "generated: the text pool types, newer than the hand-written class",
    tt_text_elements: "generated: the text pool types",
    ts_canceltravel: "generated: the function import's input structure",
    ts_travelcount: "generated: the function import's input structure",
    ts_status_vh: "TO FIX: the model says StatusVH/Text, the class says status_text",
    tt_status_vh: "TO FIX: the same, as a table type",
    ts_statusvh: "the generated pair of ts_status_vh",
    tt_statusvh: "the generated pair of tt_status_vh",
    ts_travel_deep: "TO FIX: a deep-insert structure in a class SEGW regenerates -- it belongs in _MPC_EXT",
  },
};

describe("objects a hand-written file holds out of the generator", () => {
  const report = compileAll("src", "gen/stg");
  const pairs = report.flatMap((r) => (r.shadowed ?? [])
    .filter((s) => s.name.endsWith(".clas.abap") && s.path !== undefined)
    .map((s) => ({...s, service: r.service})));

  it("there are some, and the pass names them", () => {
    // if this ever reads zero, the check below is passing on nothing
    expect(pairs.length, "no shadowed class at all -- did the report shape change?")
      .to.be.greaterThan(0);
  });

  // **A base class must match the model; an _EXT may hold more.** SEGW
  // regenerates _MPC and _DPC from the tree and wipes anything added there,
  // so a type in one of those which the model does not produce is a defect.
  // _MPC_EXT and _DPC_EXT are the developer's, generated once and empty on
  // purpose, so extra declarations are the point rather than a divergence --
  // the hand-written demo _DPC_EXT has ty_range and ty_ranges for its
  // select-options, and nothing generated would ever make them.
  const isBase = (name) => /_(mpc|dpc)\.clas\.abap$/i.test(name);

  for (const pair of pairs.filter((p) => isBase(p.name))) {
    it(`${pair.name} (${pair.service}): every type difference is named`, () => {
      const hand = typesOf(readFileSync(pair.path, "utf8"));
      const gen = typesOf(pair.generated);
      const known = KNOWN[pair.name] ?? {};
      const differing = [...new Set([...Object.keys(hand), ...Object.keys(gen)])]
        .filter((k) => JSON.stringify(hand[k]) !== JSON.stringify(gen[k]))
        .filter((k) => known[k] === undefined);
      expect(differing, `unnamed differences in ${pair.name}: ${differing.join(", ")}`)
        .to.deep.equal([]);
    });

  }

  // both kinds: an _EXT may declare more, but never the same name differently
  for (const pair of pairs) {
    it(`${pair.name} (${pair.service}): shared types are identical field for field`, () => {
      const hand = typesOf(readFileSync(pair.path, "utf8"));
      const gen = typesOf(pair.generated);
      for (const k of Object.keys(hand).filter((k) => gen[k] !== undefined)) {
        expect(gen[k], `${pair.name}: ${k} differs`).to.deep.equal(hand[k]);
      }
    });
  }
});
