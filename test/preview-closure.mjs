import {expect} from "chai";
import {configuredFor, previewClosure, uncovered, ENTRY} from "../tools/osd-preview-closure.mjs";

// **`await import()` does not keep a module out of a webpack bundle.**
//
// webpack follows a dynamic import exactly as it follows a static one: it
// makes a chunk, and `LimitChunkCountPlugin({maxChunks: 1})` glues the chunk
// back in. A comment saying "this is lazy so it stays out of the worker"
// describes an intention, and a bundle does not read comments. That is how
// `tools/osd-store.mjs` reached the service worker through `test/setup.mjs`,
// brought `tools/osd-unit.mjs` with it, and through that `require("module")`
// -- no polyfill, no `false` in the fallback list, thirteen webpack errors,
// GitHub Pages red (2026-09-19).
//
// Three green suites did not cover it because none of them bundles. This
// walks the same graph in milliseconds and names the builtins it reaches
// that the config neither polyfills nor stubs.
describe("what the preview bundle can reach", () => {
  it("follows a DYNAMIC import, because webpack does", () => {
    const {modules} = previewClosure();
    // test/setup.mjs is reached from the worker only through
    // `await import("../test/setup.mjs")`
    expect(modules.some((m) => m.endsWith("test/setup.mjs")),
      "a lazy import is still an edge of the graph").to.equal(true);
    expect(modules.length, "and the graph is the whole bundle").to.be.greaterThan(100);
  });

  it("stops at IgnorePlugin, which is the only thing that removes a module", () => {
    const {modules} = previewClosure();
    expect(modules.some((m) => m.endsWith("hana-client.mjs")), "ignored by the config").to.equal(false);
    expect(modules.some((m) => m.endsWith("duckdb-client.mjs"))).to.equal(false);
  });

  // The half that matters: the check has to be able to see the defect it was
  // written for. Its first version read 1200 characters after `fallback` and
  // swallowed the config's own `module:`, `rules:` and `plugins:` sections,
  // so it reported `module` as covered -- blind to exactly the builtin that
  // broke the build. Only testing it against that defect said so.
  it("reads the fallback OBJECT, not a window of characters around it", () => {
    const {covered} = configuredFor();
    expect(covered.has("fs"), "a real entry").to.equal(true);
    expect(covered.has("module"), "the builtin this check exists for").to.equal(false);
    expect(covered.has("rules"), "a section of the config, not a fallback").to.equal(false);
    expect(covered.has("plugins")).to.equal(false);
  });

  it("names the builtin and every module that reaches it, not just a count", () => {
    for (const one of uncovered()) {
      expect(one.builtin).to.be.a("string");
      expect(one.files, `${one.builtin} must say through what`).to.have.length.greaterThan(0);
    }
  });

  // Deliberately not asserted: that the list is empty today. This suite is
  // about the mechanism; `npm run preview:closure` is what reports the state,
  // and the build itself is what proves it (backlog 8.4).
  it("reports the state rather than asserting it, and says where the entry is", () => {
    expect(ENTRY).to.equal("web/preview-worker.mjs");
    const state = uncovered();
    if (state.length > 0) {
      console.log(`      (uncovered right now: ${state.map((o) => o.builtin).join(", ")})`);
    }
    expect(state).to.be.an("array");
  });
});
