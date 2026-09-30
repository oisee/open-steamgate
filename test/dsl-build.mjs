// dsl build (tools/dsl-build.mjs): recipes compiled, linked and rendered as a
// build unit. Every defect is planted in a scratch copy of a real recipe and
// must come back as `<recipe>/<file>:<line>: <message>`; the scanner is held
// to ZCL_OSD_TPL by rendering the same templates through the engine.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PROVIDERS, buildAll, buildRecipe, compileTemplate, format, recipeNames, renderWithEngine} from "../tools/dsl-build.mjs";

describe("dsl build: recipes as build units", function () {
  this.timeout(120000);
  const scratch = [];
  after(() => scratch.forEach((dir) => rmSync(dir, {recursive: true, force: true})));

  // A copy of a real recipe in a scratch folder with some files replaced.
  function copyOf(base, files = {}) {
    const dir = mkdtempSync(join(tmpdir(), "dsl-build-"));
    scratch.push(dir);
    cpSync(join("recipes", base), join(dir, "copy"), {recursive: true});
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, "copy", name), typeof content === "string" ? content : `${JSON.stringify(content, null, 1)}\n`);
    }
    return dir;
  }
  const build = (dir, options = {}) => buildRecipe("copy", {dir, staticOnly: true, ...options});
  const errorsOf = async (base, files, options) => (await build(copyOf(base, files), options)).errors.map(format);
  const manifest = (base, patch) => ({...JSON.parse(readFileSync(join("recipes", base, "recipe.json"), "utf8")), ...patch});

  describe("the recipes of the repository", () => {
    it("are found, all three, each with a manifest", () => {
      expect(recipeNames()).to.deep.equal(["abap-constants", "abap-methods", "r1-lookup-enrich"]);
    });

    it("build clean: compiled, linked, rendered through the engine, schema in step", async () => {
      const results = await buildAll(undefined, {check: true});
      expect(results.map((r) => [r.recipe, r.errors.map(format), r.samples])).to.deep.equal([
        ["abap-constants", [], 1], ["abap-methods", [], 1], ["r1-lookup-enrich", [], 2],
      ]);
    });

    it("every template compiles and renders through ZCL_OSD_TPL over its samples", async () => {
      for (const name of recipeNames()) {
        const recipe = JSON.parse(readFileSync(join("recipes", name, "recipe.json"), "utf8"));
        const template = readFileSync(join("recipes", name, recipe.template), "utf8");
        expect(compileTemplate(template).errors, name).to.deep.equal([]);
        for (const [label, model] of await PROVIDERS[recipe.model].samples(join("recipes", name))) {
          const rendered = await renderWithEngine(template, model);
          expect(rendered.text, `${name} ${label}`).to.be.a("string").that.is.not.empty;
        }
      }
    });
  });

  describe("compile: a defect comes back with file and line", () => {
    const methods = readFileSync("recipes/abap-methods/template.tpl", "utf8");

    it("an unclosed section", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": methods.replace("{{/classes}}", "")}))
        .to.deep.equal(["copy/template.tpl:1: section classes not closed"]);
    });

    it("an unknown filter", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": methods.replace("{{name}}", "{{name | shout}}")}))
        .to.deep.equal(['copy/template.tpl:1: unknown filter "shout"']);
    });

    it("a tag never closed, and a tag with a blank in its name", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": `${methods}\n{{name`})).to.deep.equal(["copy/template.tpl:6: tag not closed"]);
      expect(await errorsOf("abap-methods", {"template.tpl": `x\n{{ a b }}`})).to.deep.equal(['copy/template.tpl:2: invalid tag name "a b"']);
    });

    it("a mismatched close", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": methods.replace("{{/public_methods}}", "{{/classes}}")}))
        .to.deep.equal(["copy/template.tpl:5: close tag classes for public_methods"]);
    });
  });

  describe("link: partials", () => {
    const withPartials = (partials, template) => ({
      "recipe.json": manifest("abap-methods", {partials}), "template.tpl": template,
    });

    it("a partial that recipe.json does not declare", async () => {
      expect(await errorsOf("abap-methods", withPartials({}, "a\n{{> nothere}}\n")))
        .to.deep.equal(["copy/template.tpl:2: partial nothere is not declared in recipe.json"]);
    });

    it("a declared partial whose file is missing", async () => {
      expect(await errorsOf("abap-methods", withPartials({gone: "gone.tpl"}, "{{> gone}}\n")))
        .to.deep.equal(["copy/recipe.json: partial gone: gone.tpl not found"]);
    });

    it("partials that call each other", async () => {
      const errors = await errorsOf("abap-methods", {
        ...withPartials({a: "a.tpl", b: "b.tpl"}, "{{> a}}\n"), "a.tpl": "x\n{{> b}}\n", "b.tpl": "{{> a}}\n",
      });
      expect(errors).to.have.length(1);
      expect(errors[0]).to.match(/^copy\/b\.tpl:1: partials call each other in a cycle: a -> b -> a/);
    });

    it("a partial nobody calls is still linked: a missing partial in it is an error, the field checks use the model root", async () => {
      const files = {...withPartials({lonely: "lonely.tpl"}, "{{#classes}}{{name}}{{/classes}}\n"), "lonely.tpl": "x\n{{> missing}}\n"};
      expect(await errorsOf("abap-methods", files)).to.deep.equal([
        "copy/lonely.tpl:2: partial missing is not declared in recipe.json (partial is never called, checked against the model root)"]);
      const result = await build(copyOf("abap-methods", files));
      expect(result.warnings.map(format)).to.deep.equal(["copy/recipe.json: partial lonely is not called"]);
      expect(await errorsOf("abap-methods", {...files, "lonely.tpl": "{{nosuch}}\n"})).to.deep.equal([
        "copy/lonely.tpl:1: {{nosuch}} is not a field of the model root (partial is never called, checked against the model root)"]);
      expect(await errorsOf("abap-methods", {...files, "lonely.tpl": "{{#classes}}{{name}}{{/classes}}\n"})).to.deep.equal([]);
    });

    it("partials that call each other are an error though nothing calls them", async () => {
      const errors = await errorsOf("abap-methods", {
        ...withPartials({a: "a.tpl", b: "b.tpl"}, "text\n"), "a.tpl": "{{> b}}\n", "b.tpl": "\n{{> a}}\n",
      });
      expect(errors.length).to.be.greaterThan(0);
      expect(errors.join("\n")).to.match(/copy\/b\.tpl:2: partials call each other in a cycle: a -> b -> a/);
    });

    it("a partial is linked in the context of its caller, with its arguments", async () => {
      const ok = {...withPartials({p: "p.tpl"}, "{{#classes}}{{> p m=name}}{{/classes}}\n"), "p.tpl": "{{m}} {{name}}\n"};
      expect(await errorsOf("abap-methods", ok)).to.deep.equal([]);
      const bad = {...ok, "p.tpl": "{{m}} {{signature}}\n"};
      const errors = await errorsOf("abap-methods", bad);
      expect(errors).to.have.length(1);
      expect(errors[0]).to.match(/^copy\/p\.tpl:1: \{\{signature\}\} is not a field of classes\[\] \(partial called at template\.tpl:1\)$/);
      expect(await errorsOf("abap-methods", {...ok, "template.tpl": "{{#classes}}{{> p m=nothing}}{{/classes}}\n"}))
        .to.include('copy/template.tpl:1: partial argument "m=nothing" not found');
    });
  });

  describe("link: names against the schema", () => {
    const constants = readFileSync("recipes/abap-constants/template.tpl", "utf8");

    it("a tag that is not a field of its context", async () => {
      expect(await errorsOf("abap-constants", {"template.tpl": constants.replace("{{declaration_type}}", "{{nosuch}}")}))
        .to.deep.equal(["copy/template.tpl:1: {{nosuch}} is not a field of classes[].constants[]"]);
    });

    it("a field used in the wrong section context", async () => {
      // signature exists on the public_methods items only, not on the class
      const errors = await errorsOf("abap-methods", {"template.tpl": "{{#classes}}# {{name}} {{signature}}\n{{/classes}}"});
      expect(errors).to.deep.equal(["copy/template.tpl:1: {{signature}} is not a field of classes[]"]);
      // and a class field is fine from inside a method: found in an outer frame
      expect(await errorsOf("abap-methods", {"template.tpl": "{{#classes}}{{#public_methods}}{{name}} {{visibility}}\n{{/public_methods}}{{/classes}}"}))
        .to.deep.equal([]);
    });

    it("a section over a name that is not a field, and a dotted name that stops", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": "{{#nothing}}x{{/nothing}}\n"}))
        .to.deep.equal(["copy/template.tpl:1: {{nothing}} is not a field of the model root"]);
      const r1 = readFileSync("recipes/r1-lookup-enrich/template.tpl", "utf8");
      expect(await errorsOf("r1-lookup-enrich", {"template.tpl": r1.replace("{{source.table}}", "{{source.nope}}")}))
        .to.include("copy/template.tpl:1: {{source.nope}} is not a field of source");
    });

    it("a dotted name takes the nearest frame with its first part and does not retry outside", async () => {
      // `a` is in the item and in the root; a.b is only in the root's a
      const schema = {object: {a: {object: {b: "scalar"}}, list: {array: {object: {a: {object: {c: "scalar"}}}}}}};
      const files = {"schema.json": schema};
      expect(await errorsOf("r1-lookup-enrich", {...files, "template.tpl": "{{a.b}}{{#list}}{{a.c}}{{/list}}\n"})).to.deep.equal([]);
      expect(await errorsOf("r1-lookup-enrich", {...files, "template.tpl": "{{#list}}\n{{a.b}}\n{{/list}}\n"}))
        .to.deep.equal(["copy/template.tpl:2: {{a.b}} is not a field of list[].a"]);
    });

    it("a raw tag takes filters like a value tag", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": "{{#classes}}{{& name | upper}}{{{name}}}\n{{/classes}}"})).to.deep.equal([]);
      expect(await errorsOf("abap-methods", {"template.tpl": "{{#classes}}{{& name | shout}}\n{{/classes}}"}))
        .to.deep.equal(['copy/template.tpl:1: unknown filter "shout"']);
      expect(await errorsOf("abap-methods", {"template.tpl": "{{& nosuch | upper}}\n"}))
        .to.deep.equal(["copy/template.tpl:1: {{nosuch}} is not a field of the model root"]);
    });

    it("loop metadata outside a loop", async () => {
      expect(await errorsOf("abap-methods", {"template.tpl": "a\n{{@index}}\n"}))
        .to.deep.equal(["copy/template.tpl:2: {{@index}} is not inside a section over an array"]);
    });

    it("the literal filter needs the sibling @type the model writes", async () => {
      expect(await errorsOf("abap-constants", {"template.tpl": constants.replace("{{value | literal}}", "{{name | literal}}")}))
        .to.deep.equal(["copy/template.tpl:1: literal needs name@type, which the model does not have"]);
    });
  });

  describe("render: the engine and the profile on the sample", () => {
    it("a profile finding names the template line and the node", async () => {
      const dir = copyOf("abap-constants", {"template.tpl": readFileSync("recipes/abap-constants/template.tpl", "utf8").replace("{{value | literal}}.", "{{value | literal}}. ")});
      const {errors} = await buildRecipe("copy", {dir});
      expect(errors.length).to.be.greaterThan(0);
      expect(errors[0]).to.include({file: "template.tpl", line: 1});
      expect(errors[0].message).to.match(/^trailing_blank: .*node class\/zcl_sample_constants\/attribute\//);
    });

    it("an engine refusal at render time is an error with the template line", async () => {
      // no scanner sees a value: a CHAR(3) constant is given a 4-character literal in the sample
      const dir = copyOf("abap-constants");
      const samples = join(dir, "copy", "sample", "zcl_sample_constants.clas.abap");
      writeFileSync(samples, readFileSync(samples, "utf8").replace("VALUE 'xyz'", "VALUE 'xyzw'"));
      const {errors} = await buildRecipe("copy", {dir});
      expect(errors.map(format)).to.deep.equal(["copy/template.tpl:1: literal value exceeds length (sample sample)"]);
    });
  });

  describe("schema drift (--check)", () => {
    const read = (base) => JSON.parse(readFileSync(join("recipes", base, "schema.json"), "utf8"));

    it("a schema lacking a field the provider produces", async () => {
      const schema = read("abap-methods");
      delete schema.object.classes.array.object.methods.array.object.parameters.array.object.default;
      const dir = copyOf("abap-methods", {"schema.json": schema});
      expect((await build(dir)).errors, "without --check the template does not use it").to.deep.equal([]);
      const {errors} = await build(dir, {check: true});
      expect(errors.map(format)).to.deep.equal([
        "copy/schema.json: the model has classes[].methods[].parameters[].default, the schema lacks it"]);
    });

    it("a schema with a field the provider never produces", async () => {
      const schema = read("r1-lookup-enrich");
      schema.object.loop.object.stale = "scalar";
      const dir = copyOf("r1-lookup-enrich", {"schema.json": schema});
      expect((await build(dir)).errors).to.deep.equal([]);
      const {errors} = await build(dir, {check: true});
      expect(errors.map(format)).to.deep.equal(["copy/schema.json: the schema has loop.stale, the model never produces it"]);
    });

    it("a field of another shape", async () => {
      const schema = read("r1-lookup-enrich");
      schema.object.hit = {object: {}};
      const {errors} = await build(copyOf("r1-lookup-enrich", {"schema.json": schema}), {check: true});
      expect(errors.map(format)).to.deep.equal(["copy/schema.json: hit is an object in the schema and a scalar in the model"]);
    });
  });

  describe("the command line", () => {
    const run = (...args) => spawnSync("node", ["tools/dsl-build.mjs", ...args], {encoding: "utf8"});

    it("prints a line per recipe and exits 1 on an error, 0 without", () => {
      const dir = copyOf("abap-methods", {"template.tpl": "{{#classes}}\n"});
      const bad = run("--static", "--dir", dir, "copy");
      expect(bad.status).to.equal(1);
      expect(bad.stdout).to.include("FAIL copy: 1 error(s)").and.include("copy/template.tpl:1: section classes not closed");
      const good = run("--static");
      expect(good.status).to.equal(0);
      expect(good.stdout.trim().split("\n")).to.have.length(3);
      expect(good.stdout).to.include("ok   abap-constants: compiled and linked");
    });

    it("an unknown recipe is an error", () => {
      const result = run("--static", "no-such-recipe");
      expect(result.status).to.equal(1);
      expect(result.stdout).to.include("no-such-recipe/recipe.json: no such recipe");
    });
  });

  describe("the scanner agrees with the engine", () => {
    const data = {x: "1", a: [{b: "2"}]};
    const lineAndText = (message) => { const m = /^main:(\d+): (.*)$/s.exec(message); return {line: +m[1], message: m[2]}; };

    // each of these is refused by ZCL_OSD_TPL when rendered, and must be here
    const refused = [
      ["a tag never closed", "x\n{{x"],
      ["a triple tag never closed", "{{{x}}"],
      ["a blank in a name", "{{x}}\n{{ a b }}"],
      ["an empty tag", "{{}}"],
      ["an empty section name", "{{#}}"],
      ["a close without an open", "{{/a}}"],
      ["a close of the wrong section", "{{#a}}\n{{/b}}"],
      ["a section not closed", "a\n{{#a}}\n{{x}}"],
      ["an unknown filter", "{{x | shout}}"],
      ["an empty filter", "{{x||upper}}"],
      ["pad without a width", "{{x | pad}}"],
      ["pad with a width too large", "{{x | pad 300}}"],
      ["pad with a word", "{{x | pad abc}}"],
      ["lower with an argument", "{{x | lower now}}"],
      ["literal with an argument", "{{x | literal 1}}"],
    ];
    for (const [title, template] of refused) {
      it(`refuses ${title} with the engine's line and text`, async () => {
        let engineMessage;
        try {
          await renderWithEngine(template, data);
        } catch (error) {
          engineMessage = error.message;
        }
        expect(engineMessage, "the engine refuses it").to.be.a("string");
        const {errors} = compileTemplate(template);
        expect(errors, "dsl-build refuses it").to.not.be.empty;
        expect(errors[0]).to.deep.equal(lineAndText(engineMessage));
      });
    }

    it("refuses a partial argument that is not name=path, as the engine does", async () => {
      const template = "{{> p q}}";
      let message;
      try {
        await renderWithEngine(template, data, {p: "[{{x}}]"});
      } catch (error) {
        message = error.message;
      }
      expect(message).to.equal('main:1: partial argument "q" is not name=path');
      expect(compileTemplate(template).errors[0]).to.deep.equal(lineAndText(message));
    });

    // and what the engine renders is not refused
    const accepted = ["{{{x}}}", "{{& x}}", "{{! any words here }}", "{{x | pad 5 | upper}}", "{{& x | upper}}", "{{x |}}",
      "{{#a}}{{.}}{{/a}}", "{{#a}}{{b}}{{@index}}{{^@last}},{{/@last}}{{/a}}{{^z}}none{{/z}}", "  {{#a}}\n  {{b}}\n  {{/a}}",
      "{{> p m=x}}"];
    for (const template of accepted) {
      it(`accepts ${JSON.stringify(template)}`, async () => {
        expect(compileTemplate(template).errors).to.deep.equal([]);
        await renderWithEngine(template, data, {p: "{{m}}"});
      });
    }

    it("is stricter than the engine only for what the engine never reaches", async () => {
      // the engine checks a filter only where it renders; the build checks every tag
      const template = "{{#missing}}{{x | shout}}{{/missing}}ok";
      expect((await renderWithEngine(template, data)).text).to.equal("ok");
      expect(compileTemplate(template).errors[0]).to.deep.equal({line: 1, message: 'unknown filter "shout"'});
    });
  });
});
