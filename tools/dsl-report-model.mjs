// A report selection screen, lifted from the converter IR used by osabap.
import {readFileSync, readdirSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {createRequire} from "node:module";
import {home} from "./gogen/home.mjs";
import {DDIC_PROVIDER, registryFor} from "./dsl-ddic.mjs";

const require = createRequire(import.meta.url);
const {DDIC} = require("@abaplint/core/build/src/ddic.js");
const names = (items) => [...new Set(items.map((item) => item.name))];
const goList = (items) => items.map(JSON.stringify).join(", ");
const goMap = (items) => items.map((name) => `${JSON.stringify(name)}: true`).join(", ");
const option = (name) => `--${name.toLowerCase().replaceAll("_", "-")}`;
const shortOption = (name) => option(name.startsWith("P_") ? name.slice(2) : name);
const rawDefault = (value) => value?.startsWith("'") && value.endsWith("'")
  ? value.slice(1, -1).replaceAll("''", "'") : value?.startsWith("`") && value.endsWith("`") ? value.slice(1, -1).replaceAll("``", "`") : value;
const DEFAULT_TOKEN = "(?:'(?:''|[^'])*'|`(?:``|[^`])*`|[^\\s]+)";
const typedDefault = (value) => value !== undefined && (/^'(?:''|[^'])*'$/.test(value)
  || /^`(?:``|[^`])*`$/.test(value) || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value));
const defaultFields = (raw, prefix, ddic, type, typeName) => {
  if (raw === undefined) return {};
  const value = rawDefault(raw);
  return typedDefault(raw)
    ? {[prefix]: value, [`${prefix}@type`]: DDIC_PROVIDER.literalType(ddic.reg, type, typeName),
      [`${prefix}_literal`]: value, [`${prefix}_literal@type`]: DDIC_PROVIDER.literalType(ddic.reg, type, typeName)}
    : {[prefix]: value, [`${prefix}_raw`]: value};
};

export async function reportModel(input) {
  const path = resolve(input);
  const reports = path.endsWith(".prog.abap") ? [path] : readdirSync(path)
    .filter((file) => file.endsWith(".prog.abap")).map((file) => join(path, file));
  if (reports.length !== 1) throw new Error(`${input}: expected exactly one .prog.abap report`);
  const report = reports[0];
  const program = basename(report).replace(/\.prog\.abap$/i, "").toUpperCase();
  if (!/\.prog\.abap$/i.test(report)) throw new Error(`${input}: expected a .prog.abap report`);
  const source = readFileSync(report, "utf8");
  const className = `ZCL_OSABAP_${program.replace(/^Z/, "")}`;
  const {convertProgram} = await import(join(home, ".local", "lars", "open-abap-gui", "converter", "src", "api.mjs"));
  const converted = await convertProgram({source, filename: report, mode: "strict", className, transactionCode: program});
  if (converted.supported !== true || converted.classSource === undefined) {
    throw new Error(`${report}: converter refused the report: ${JSON.stringify(converted.diagnostics)}`);
  }
  const ddic = new DDIC(registryFor([dirname(report)], [{name: basename(report), source}]));
  const selections = (converted.reportIR?.selections ?? []).flatMap((screen) => screen.elements ?? [])
    .filter((element) => element.name);
  const elements = selections.map((item) => {
    const name = item.name.toUpperCase();
    const checkbox = item.kind === "parameter" && /\bAS\s+CHECKBOX\b/i.test(item.additions ?? "");
    const group = /\bRADIOBUTTON\s+GROUP\s+(\w+)/i.exec(item.additions ?? "")?.[1]?.toUpperCase();
    const kind = group ? "radiobutton" : checkbox ? "checkbox" : item.kind;
    const referred = /\bFOR\s+(\w+)/i.exec(item.additions ?? "")?.[1]?.toUpperCase();
    const reference = selections.find((candidate) => candidate.name.toUpperCase() === referred);
    const dataType = reference?.dataType ?? item.dataType;
    const implicitChar = item.kind === "parameter" && !/\b(?:TYPE|LIKE|AS)\b/i.test(item.additions ?? "");
    const typeName = checkbox || group || implicitChar ? "C" : dataType?.rollname ?? dataType?.typ;
    if (!typeName) throw new Error(`${report}: ${name} has no type`);
    const type = ddic.lookupBuiltinType(typeName, checkbox || group || implicitChar ? 1 : dataType?.length, dataType?.decimals)
      ?? ddic.lookup(typeName).type;
    const display = DDIC_PROVIDER.type(ddic.reg, type, typeName);
    // The converter keeps additions in IR but its default field currently
    // omits backtick strings; read that one literal form from the IR.
    const additions = item.additions ?? "";
    const raw = item.default ?? new RegExp(`\\bDEFAULT\\s+(${DEFAULT_TOKEN})`, "i").exec(additions)?.[1];
    const upper = item.kind === "select-option" ? new RegExp(`\\bDEFAULT\\s+${DEFAULT_TOKEN}\\s+TO\\s+(${DEFAULT_TOKEN})`, "i").exec(additions)?.[1] : undefined;
    const sign = item.kind === "select-option" ? /\bSIGN\s+(\w+)/i.exec(additions)?.[1] : undefined;
    const optionValue = item.kind === "select-option" ? /\bOPTION\s+(\w+)/i.exec(additions)?.[1] : undefined;
    const cli = [shortOption(name), ...(name.startsWith("P_") ? [option(name)] : [])];
    const baseLabel = display.data_element ?? display.abap_type ?? display.built_in ?? typeName.toLowerCase();
    const typeLabel = display.length === undefined ? baseLabel : `${baseLabel}(${display.length}${display.decimals ? `,${display.decimals}` : ""})`;
    const facts = [typeLabel,
      ...(checkbox ? ["flag"] : []), ...(/\bOBLIGATORY\b/i.test(item.additions ?? "") ? ["obligatory"] : []),
      ...(group ? [`radio ${group}`] : [])].join(", ");
    const selectionText = /^D\s*\.$/i.test(item.text?.trim() ?? "") ? "" : item.text && item.text !== item.name ? item.text : "";
    return {"@id": `report/${program}/sel/${name}`, name, kind, source_kind: item.kind, cli, cli_label: cli.join(", "),
      "@type": display, ...defaultFields(raw, "default", ddic, type, typeName),
      ...defaultFields(upper, "default_to", ddic, type, typeName),
      ...(sign ? {default_sign: sign} : {}), ...(optionValue ? {default_option: optionValue} : {}),
      obligatory: /\bOBLIGATORY\b/i.test(item.additions ?? ""),
      ...(group ? {radio_group: group} : {}),
      ...(selectionText ? {selection_text: selectionText} : {}),
      text: selectionText,
      type_label: typeLabel, facts, positional: item.kind === "parameter" && !checkbox, checkbox};
  });
  const selectionNames = names(elements);
  const positionals = elements.filter((element) => element.positional).map((element) => element.name);
  const checkboxes = elements.filter((element) => element.checkbox).map((element) => element.name);
  const ranges = elements.filter((element) => element.source_kind === "select-option").map((element) => element.name);
  const groups = [...new Set(elements.map((element) => element.radio_group).filter(Boolean))]
    .map((name) => ({"@id": `report/${program}/radio/${name}`, name,
      members: elements.filter((element) => element.radio_group === name).map((element) => element.cli[0]).join(", ")}));
  return {"@id": `report/${program}`, name: program.toLowerCase(), elements, groups,
    selection_names: selectionNames, positionals, checkboxes, ranges,
    go_selection_names: goList(selectionNames), go_positionals: goList(positionals),
    go_checkboxes: goMap(checkboxes), go_ranges: goMap(ranges),
    go_selection_decl: `var appSelectionNames = []string{${goList(selectionNames)}}`,
    go_positionals_decl: `var appPositionals = []string{${goList(positionals)}}`,
    go_checkboxes_decl: `var appCheckboxes = map[string]bool{${goMap(checkboxes)}}`,
    go_ranges_decl: `var appRanges = map[string]bool{${goMap(ranges)}}`};
}
