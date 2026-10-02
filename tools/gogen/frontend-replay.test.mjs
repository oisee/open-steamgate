import {test} from "node:test";
import assert from "node:assert/strict";
import {recordLowering, replayLowering} from "./frontend-replay.mjs";

const program = () => ({wanted: new Set(["BASE"]), sigs: new Map(), skipped: [], currentClass: undefined});
test("replay checks dependency membership and preserves ordered effects atomically", () => {
  const first = program();
  const cached = recordLowering(first, (p) => {
    p.currentClass = "CALLER";
    p.sigs.set("CALLER=>RUN", {type: "i"});
    assert.equal(p.sigs.get("CALLER=>RUN").type, "i");
    if (!p.wanted.has("DEPENDENCY")) p.skipped.push("dependency absent");
    return {name: "CALLER"};
  });
  assert.ok(cached.replay);
  const next = program();
  next.wanted.add("UNRELATED");
  assert.ok(replayLowering(next, cached.replay));
  assert.deepEqual(next.sigs, first.sigs);
  assert.deepEqual(next.skipped, first.skipped);
  assert.ok(next.wanted.has("UNRELATED"));
  const changed = program();
  changed.wanted.add("DEPENDENCY");
  assert.equal(replayLowering(changed, cached.replay), false);
  assert.equal(changed.sigs.size, 0);
  assert.equal(changed.currentClass, undefined);
  assert.deepEqual(changed.skipped, []);
});

test("nested mutations and previous-class traversal refuse caching", () => {
  const p = program();
  p.sigs.set("BASE=>RUN", {type: "i"});
  assert.equal(recordLowering(p, (p) => { p.sigs.get("BASE=>RUN").type = "int8"; }).replay, undefined);
  p.classes = [];
  assert.equal(recordLowering(p, (p) => p.classes.length).replay, undefined);
});

test("assigned collections replay from their initial state without sharing cache storage", () => {
  const first = program();
  const cached = recordLowering(first, (p) => {
    p.output = new Map();
    assert.equal(p.output.has("TYPE"), false);
    p.output.set("TYPE", 80);
    p.wanted.has("DEPENDENCY");
  });
  assert.ok(cached.replay);
  const next = program();
  assert.ok(replayLowering(next, cached.replay));
  next.output.set("UNRELATED", 10);
  assert.equal(first.output.has("UNRELATED"), false);
  const changed = program();
  changed.wanted.add("DEPENDENCY");
  assert.equal(replayLowering(changed, cached.replay), false);
  assert.equal(changed.output, undefined);
  assert.ok(replayLowering(program(), cached.replay));
});
