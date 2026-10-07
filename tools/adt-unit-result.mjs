// ABAP Unit result documents and navigation, shared by the facade callers.
import {xmlEscape, uriOf} from "./adt-documents.mjs";
import {requestElements, elementsNamed, attributeValue, namespaces} from "./adt-request-xml.mjs";

// The result of a test run: a program, its test classes, their methods, and
// the alerts on whichever of them failed. No alert on a method is what
// "passed" means. SAP emits a self-closing passing testMethod.
// The file a stack frame names, as an address in the facade. The suffix
// says which include of a class it is; anything else we do not serve by
// this route comes back undefined and the caller keeps the file name.
const FRAME_INCLUDES = {
  "locals_def": "definitions",
  "locals_imp": "implementations",
  "macros": "macros",
  "testclasses": "testclasses",
};
const CLASS_POOL_INCLUDES = {definitions: "CCDEF", implementations: "CCIMP", macros: "CCMAC", testclasses: "CCAU", main: "CP"};

// SAP assertion comparison text, shared by XML and STORE JSON. Only a whole
// negative numeric value changes; empty values and other strings stay as is.
export const unitValueText = value => typeof value === "string" && /^-\d+(?:\.\d+)?$/.test(value)
  ? `${value.slice(1)}-` : value;

function classFrame(file) {
  if (typeof file !== "string") return undefined;
  const match = /^(.+)\.clas(?:\.([a-z_]+))?\.abap$/i.exec(file.split("/").pop());
  if (match === null) return undefined;
  const include = match[2] === undefined ? "main" : FRAME_INCLUDES[match[2].toLowerCase()];
  if (include === undefined) return undefined;
  return {name: match[1].replaceAll("#", "/").toUpperCase(), include};
}

export function frameUri(file, line, column, {sourceMain = false} = {}) {
  if (typeof file !== "string" || file === "") {
    return undefined;
  }
  const name = file.split("/").pop();
  const at = `#start=${line ?? 1},${column ?? 1}`;
  const clas = classFrame(file);
  if (clas !== undefined) {
    return `${uriOf("CLAS", clas.name)}${clas.include === "main" ? "" : `/includes/${clas.include}`}${sourceMain ? "/source/main" : ""}${at}`;
  }
  const prog = /^(.+)\.prog\.abap$/.exec(name);
  if (prog !== null) {
    return `${uriOf("PROG", prog[1])}/source/main${at}`;
  }
  return undefined;
}

export function unitResultDocument(run, options = {}) {
  const type = run.program?.objectType ?? run.program?.typeName ?? run.program?.type?.split("/")[0] ?? "CLAS";
  const base = options.base ?? uriOf(type, run.program?.name ?? "") ?? "";
  if (type === "CLAS") return classUnitResultDocument(run, base, options.withNavigationUri !== false);
  const at = (include, line, column) => `${base}/includes/${include ?? "testclasses"}/source/main#start=${line ?? 1},${column ?? 1}`;

  // A frame arrives as the file the source map resolved to, which is a file
  // name and not an address a client can follow. Turned into one here, so a
  // failure is a place to jump to; a file whose shape we do not recognise
  // keeps its name and gets no navigationUri, because a link that goes
  // nowhere is worse than no link.
  const stackEntry = (e) => {
    const uri = frameUri(e.uri, e.line, e.column);
    return `            <stackEntry adtcore:uri="${xmlEscape(uri ?? e.uri ?? "")}" adtcore:name="${xmlEscape(e.name ?? "")}" adtcore:description="${xmlEscape(e.line === undefined ? "" : "line " + e.line)}"${uri === undefined || options.withNavigationUri === false ? "" : ` navigationUri="${xmlEscape(uri)}"`}/>`;
  };

  const alert = (a) => `        <alert kind="${xmlEscape(a.kind ?? "failedAssertion")}" severity="${xmlEscape(a.severity ?? "critical")}">
          <title>${xmlEscape(a.title ?? "")}</title>
          <details>
${(a.details ?? []).map((d) => `            <detail text="${xmlEscape(d)}"/>`).join("\n")}
          </details>
          <stack>
${(a.stack ?? []).map(stackEntry).join("\n")}
          </stack>
        </alert>`;

  const alerts = (items, indent) => {
    if ((items ?? []).length === 0) return `${indent}<alerts/>`;
    return `${indent}<alerts>\n${items.map(alert).join("\n")}\n${indent}</alerts>`;
  };

  const navigation = uri => options.withNavigationUri === false ? "" : ` navigationUri="${xmlEscape(uri)}"`;
  const method = (m, include) => `      <testMethod adtcore:name="${xmlEscape(m.name)}" adtcore:uri="${xmlEscape(at(include, m.line, m.column))}" executionTime="${xmlEscape(m.executionTime ?? "0.000")}" unit="${xmlEscape(m.unit ?? "s")}"${navigation(at(include, m.line, m.column))}>
${alerts(m.alerts, "        ")}
      </testMethod>`;

  const testClass = (c) => `    <testClass adtcore:name="${xmlEscape(c.name)}" adtcore:uri="${xmlEscape(at(c.include, c.line, c.column))}" durationCategory="${xmlEscape(c.durationCategory ?? "short")}" riskLevel="${xmlEscape(c.riskLevel ?? "harmless")}"${navigation(at(c.include, c.line, c.column))}>
${alerts(c.alerts, "      ")}
      <testMethods>
${(c.testMethods ?? []).map((m) => method(m, c.include)).join("\n")}
      </testMethods>
    </testClass>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit" xmlns:adtcore="http://www.sap.com/adt/core">
  <program adtcore:name="${xmlEscape(run.program?.name ?? "")}" adtcore:type="${xmlEscape(run.program?.type ?? "CLAS/OC")}" adtcore:uri="${xmlEscape(base)}">
    <testClasses>
${(run.testClasses ?? []).map(testClass).join("\n")}
    </testClasses>
  </program>
</aunit:runResult>
`;
}

// CLAS protocol facts measured on SAP, 2026-10-06. Semantic identities
// select tests; navigation selects source members; only stack frames select
// lines. A requested technical uriType does not change the result.
function classUnitResultDocument(run, base, withNavigationUri) {
  const programName = String(run.program?.name ?? "").toUpperCase();
  const poolName = name => name.padEnd(30, "=");
  const navigation = (type, uri) => withNavigationUri
    ? ` adtcore:type="${type}" navigationUri="${xmlEscape(uri)}"` : "";
  const includeUri = include => include === "main" ? base : `${base}/includes/${include ?? "testclasses"}`;
  const stackEntry = (entry, methodName) => {
    const frame = classFrame(entry.uri);
    if (frame === undefined) {
      return `            <stackEntry adtcore:uri="${xmlEscape(frameUri(entry.uri, entry.line, entry.column) ?? entry.uri ?? "")}" adtcore:name="${xmlEscape(entry.name ?? "")}" adtcore:description="${xmlEscape(entry.line === undefined ? "" : "line " + entry.line)}"/>`;
    }
    const description = `Include: <${poolName(frame.name)}${CLASS_POOL_INCLUDES[frame.include]}> Line: <${entry.line ?? 1}>${methodName ? ` (${methodName})` : ""}`;
    return `            <stackEntry adtcore:uri="${xmlEscape(frameUri(entry.uri, entry.line, 0))}" adtcore:type="CLAS/OCN/${frame.include}" adtcore:name="${xmlEscape(frame.name)}" adtcore:description="${xmlEscape(description)}"/>`;
  };
  const detail = text => `            <detail text="${xmlEscape(text)}"/>`;
  const alert = (a, c, m) => {
    const items = a.details ?? [];
    const comparison = items.filter(d => /^(Expected|Actual) \[[\s\S]*\]$/.test(d));
    const failedAssertion = (a.kind ?? "failedAssertion") === "failedAssertion";
    const raised = items.find(d => /^Raised in \w+$/.test(d))?.slice("Raised in ".length);
    const methodName = m?.name ?? raised?.toUpperCase();
    const title = a.title || "Unit test assertion failed";
    const message = title === "Unit test assertion failed" && comparison.length > 0 ? "ASSERT_EQUALS" : title;
    const renderedTitle = failedAssertion && methodName && !title.startsWith("Critical Assertion Error:")
      ? `Critical Assertion Error: '${methodName[0].toUpperCase()}${methodName.slice(1).toLowerCase()}: ${message}'` : title;
    const details = [];
    if (failedAssertion && comparison.length > 0) {
      const text = comparison.map(d => d.replace(/^(Expected|Actual) \[([\s\S]*)\]$/, (_, kind, value) => `${kind} [${unitValueText(value)}]`)).join(" ");
      details.push(`            <detail text="Different values"><details><detail text="${xmlEscape(text)}"/></details></detail>`);
    }
    details.push(...items.filter(d => !(failedAssertion && comparison.includes(d)) &&
      !(methodName && d.toLowerCase() === `raised in ${methodName.toLowerCase()}`)).map(detail));
    if (methodName) details.push(detail(`Test '${c.name}->${methodName}' in Main Program '${poolName(programName)}CP'`));
    return `        <alert kind="${xmlEscape(a.kind ?? "failedAssertion")}" severity="${xmlEscape(a.severity ?? "critical")}">
          <title>${xmlEscape(renderedTitle)}</title>
          <details>
${details.join("\n")}
          </details>
          <stack>
${(a.stack ?? []).map(e => stackEntry(e, methodName)).join("\n")}
          </stack>
        </alert>`;
  };
  const alerts = (items, indent, c, m) => (items ?? []).length === 0 ? `${indent}<alerts/>`
    : `${indent}<alerts>\n${items.map(a => alert(a, c, m)).join("\n")}\n${indent}</alerts>`;
  const method = (m, c) => {
    const identity = `${base}#testclass=${encodeURIComponent(c.name)};testmethod=${encodeURIComponent(m.name)}`;
    const target = `${includeUri(c.include)}#type=CLAS%2FOLD;name=${encodeURIComponent(c.name.padEnd(30, " ") + m.name)}`;
    const executionTime = m.executionTime === undefined ? "0" : String(m.executionTime).replace(/\.0+$/, "");
    const open = `      <testMethod adtcore:name="${xmlEscape(m.name)}" adtcore:uri="${xmlEscape(identity)}" executionTime="${xmlEscape(executionTime)}" unit="${xmlEscape(m.unit ?? "s")}" uriType="semantic"${navigation("CLAS/OLI", target)}`;
    return (m.alerts ?? []).length === 0 ? `${open}/>` : `${open}>\n${alerts(m.alerts, "        ", c, m)}\n      </testMethod>`;
  };
  const testClass = c => `    <testClass adtcore:name="${xmlEscape(c.name)}" adtcore:uri="${xmlEscape(`${base}#testclass=${encodeURIComponent(c.name)}`)}" durationCategory="${xmlEscape(c.durationCategory ?? "short")}" riskLevel="${xmlEscape(c.riskLevel ?? "harmless")}" uriType="semantic"${navigation("CLAS/OL", `${includeUri(c.include)}#type=CLAS%2FOCL;name=${encodeURIComponent(c.name)}`)}>
${(c.alerts ?? []).length === 0 ? "" : alerts(c.alerts, "      ", c) + "\n"}      <testMethods>
${[...(c.testMethods ?? [])].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(m => method(m, c)).join("\n")}
      </testMethods>
    </testClass>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
  <program xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${xmlEscape(programName)}" adtcore:type="CLAS/OC" adtcore:uri="${xmlEscape(base)}" uriType="semantic">
    <testClasses>
${(run.testClasses ?? []).map(testClass).join("\n")}
    </testClasses>
  </program>
</aunit:runResult>
`;
}

// Run and evaluation share the namespace-aware run configuration options.
export function unitResultOptions(body, object) {
  const elements = requestElements(body);
  const configuration = elementsNamed(elements, namespaces.aunit, "runConfiguration")[0];
  const options = elements.filter(e => e.parent === elements.indexOf(configuration) + 1 &&
    e.local === "options" && (e.uri === "" || e.uri === namespaces.aunit));
  const navigation = elements.find(e => options.some(o => e.parent === elements.indexOf(o) + 1) &&
    e.local === "withNavigationUri" && (e.uri === "" || e.uri === namespaces.aunit));
  return {
    base: uriOf(object.type, object.name),
    withNavigationUri: !["false", "0"].includes(attributeValue(navigation, "", "enabled")),
  };
}
