// Opt-in cockpit: the service compiler owns the model; recipes own the extension.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import yaml from "js-yaml";
import {compile} from "./stg-compile.mjs";
import {renderRecipe} from "./dsl-abap.mjs";
import {governorTemplate} from "./dsl-l3-governor.mjs";
import {cockpitService, cockpitActions} from "./dsl-l3-cockpit-service.mjs";
import {cockpitPages} from "./dsl-l3-cockpit-pages.mjs";

export function compileCockpit(doc, model, {line, fail}) {
  const spec = doc.cockpit, at = line("cockpit");
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(at, "cockpit is {app, service, title}");
  for (const key of Object.keys(spec)) if (!["app", "service", "title"].includes(key)) fail(line(`cockpit/${key}`), `unknown cockpit key ${key}`);
  if (!model.staged) fail(at, "cockpit requires stages");
  if (typeof spec.app !== "string" || !/^[zy][a-z0-9_]{0,14}$/i.test(spec.app)) fail(line("cockpit/app"), "cockpit.app is a Z or Y BSP name of at most 15 characters");
  if (typeof spec.service !== "string" || !/^[zy][a-z0-9_]{0,29}$/i.test(spec.service)) fail(line("cockpit/service"), "cockpit.service is a Z or Y name of at most 30 characters");
  if (typeof spec.title !== "string" || !spec.title.trim() || /[\r\n]/.test(spec.title)) fail(line("cockpit/title"), "cockpit.title is one nonempty line");
  // The generated ZCL_<project>_MPC_EXT must still fit a 30-character
  // class name for the longest legal set name. Keep short names readable.
  const project = model.set.length <= 13 ? `ZL3C_${model.set}` : `ZL3C_${model.set.slice(0, 5)}_${createHash("sha256").update(model.set).digest("hex").slice(0, 7)}`;
  return {"@id": `${model["@id"]}/cockpit`, set_line: at, app: spec.app.toLowerCase(), service: spec.service.toUpperCase(),
    title: spec.title, project: project.toUpperCase()};
}

export function cockpitRunnerTemplate(model, text, kind = "runner") {
  if (!model.cockpit) return text;
  return governorTemplate(text, JSON.parse(readFileSync(`recipes/l3-cockpit/${kind}.patch.json`, "utf8")));
}

export async function renderCockpit(model) {
  const c = model.cockpit, service = cockpitService(model);
  const source = yaml.dump(service.doc, {lineWidth: -1, noRefs: true});
  const result = compile(source, {file: `${c.project.toLowerCase()}.stg.yaml`});
  const root = {...c, set: model.set, "set@type": {built_in: "CHAR", length: 16}, runner: model.class, base: result.model.classes.dpc.toLowerCase(),
    class: result.model.classes.dpcExt.toLowerCase(), mpc: result.model.classes.mpc.toLowerCase(),
    settings_class: model.settings?.class, stage_count: String(model.stages.length), resilience: Boolean(model.resilience), governed: Boolean(model.governor), entities: service.entities, actions: cockpitActions(model)};
  const ext = await renderRecipe(root, "recipes/l3-cockpit/dpc.tpl", {profile: "abap"});
  const error = ext.findings.find((f) => f.severity === "E");
  if (error) throw new Error(`cockpit DPC line ${error.line}: ${error.text}`);
  const files = {[`${c.project.toLowerCase()}.stg.yaml`]: source, [`${root.class}.clas.xml`]: result.ext[`${root.class}.clas.xml`],
    [`${root.class}.clas.abap`]: ext.text, ...await cockpitPages(model)};
  const objects = Object.entries({...result.files, ...result.classes, ...result.ext}).map(([name, text]) =>
    `  ${JSON.stringify(name)}: [\n` + text.trimEnd().split("\n").map((_, i) =>
      "   " + JSON.stringify({line: i + 1, template_line: i + 1, node: c["@id"], set_line: c.set_line})).join(",\n") + "\n  ]");
  files[`${c.project.toLowerCase()}.service.trace.json`] = `{"generator":"dsl-l3-cockpit","set":${JSON.stringify(model.source)},\n "objects": {\n${objects.join(",\n")}\n }\n}\n`;
  // stg-compile's base objects have no per-line source map. The entire service
  // is owned by the cockpit node; the recipe extension also retains its path.
  for (const [name, text] of Object.entries({...files})) {
    if (name.endsWith(".trace.json")) continue;
    const traced = name === `${root.class}.clas.abap` ? ext.trace : text.trimEnd().split("\n").map((_, i) => ({line: i + 1, template_line: i + 1}));
    files[`${name}.trace.json`] = JSON.stringify({generator: "dsl-l3-cockpit", set: model.source,
      model: `sha256:${createHash("sha256").update(JSON.stringify(model)).digest("hex")}`,
      template: name === `${root.class}.clas.abap` ? "recipes/l3-cockpit/dpc.tpl" : name.endsWith(".stg.yaml") ? "dsl-l3-cockpit-service" : name.includes("cockpit/") ? `recipes/l3-cockpit/${name.split("/").at(-1)}` : "stg-compile",
      lines: traced.map((t) => ({...t, node: c["@id"], set_line: c.set_line}))}, null, 1) + "\n";
  }
  return files;
}
