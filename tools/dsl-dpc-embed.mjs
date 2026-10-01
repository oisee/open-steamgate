#!/usr/bin/env node
// Embed the reviewed DPC templates in an ABAP class for offline and SAP use.
import {readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const dir = "src/dsl/dpc-templates";
const target = "src/dsl/zcl_osd_dsl_dpc_templates.clas.abap";
const quote = (line) => `\`${line.replaceAll("`", "``")}\``;
export function embeddedSource() {
const names = readdirSync(dir).filter((name) => name.endsWith(".tpl")).sort().map((file) => file.slice(0, -4));
const methods = names.map((name) => {
  const content = readFileSync(join(dir, `${name}.tpl`), "utf8");
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const expression = lines.flatMap((line) => {
    const parts = line.split("\t");
    const values = parts.flatMap((part, index) => [
      ...(index > 0 ? ["      && cl_abap_char_utilities=>horizontal_tab"] : []),
      ...(part.match(/[\s\S]{1,170}/g) ?? []).map((chunk) => `      && ${quote(chunk)}`),
    ]);
    return [...values, "      && cl_abap_char_utilities=>newline"];
  }).join("\n");
  return `      WHEN '${name}'.\n        rv_text = \`\`\n${expression}.`;
});
const nameRows = names.filter((name) => name !== "class").map((name) => `    APPEND '${name}' TO rt_names.`).join("\n");
return `CLASS zcl_osd_dsl_dpc_templates DEFINITION PUBLIC FINAL CREATE PRIVATE.\n  PUBLIC SECTION.\n    CLASS-METHODS get IMPORTING iv_name TYPE string RETURNING VALUE(rv_text) TYPE string.\n    CLASS-METHODS names RETURNING VALUE(rt_names) TYPE string_table.\nENDCLASS.\n\nCLASS zcl_osd_dsl_dpc_templates IMPLEMENTATION.\n  METHOD get.\n    CASE iv_name.\n${methods.join("\n")}\n    ENDCASE.\n  ENDMETHOD.\n  METHOD names.\n${nameRows}\n  ENDMETHOD.\nENDCLASS.\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = embeddedSource();
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== source) throw new Error(`${target} differs from templates`);
  } else writeFileSync(target, source);
}
