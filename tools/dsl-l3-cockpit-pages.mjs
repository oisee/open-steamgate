// All web assets come from recipes. Paths are relative to the set's output.
import {readFileSync} from "node:fs";
import {renderRecipe} from "./dsl-abap.mjs";
import {cockpitActions} from "./dsl-l3-cockpit-service.mjs";
// Two apps per set: "Runs <set>" (list report and run page, what is about one run) and
// "Set <set>" (settings with their audit, schedule, kill switch, doctor).
const RUN_ACTIONS = ["StartRun", "ContinueGlass", "Resume", "ReleasePile"];
const RUNS_FILES = ["index.html", "Component.js", "manifest.json", "Cockpit.controller.js", "Cockpit.fragment.xml", "List.controller.js",
  "StartRun.fragment.xml", "i18n.properties"];
const SET_FILES = ["index.html", "Component.js", "manifest.json", "Set.view.xml", "Set.controller.js", "i18n.properties"];
const published = (name) => name === "i18n.properties" ? "i18n/i18n.properties" : name;
// the open runs: a status that is not final (the tile's number); a run's status is its
// last stage's (DONE, PARTIAL, NOT-RUN when final) or GLASS
const OPEN = ["DONE", "PARTIAL", "FAILED", "NOT-RUN"].map((s) => `Status ne '${s}'`).join(" and ");
export async function cockpitPages(m) {
  const c = m.cockpit, files = {};
  const actions = cockpitActions(m).filter((a) => !a.get).map(({name, params, reason}) => ({name, params, reason: !!reason}));
  const settings = (m.settings?.entries ?? []).map(({name, default: value, min, max}) => ({name, default: value, min, max}));
  const json = (v) => JSON.stringify(v, null, 1).replaceAll("\n", "\n  ");
  const runs = {service: c.service, actions: actions.filter((a) => RUN_ACTIONS.includes(a.name)), governor: !!m.governor, simulate: !!m.simulate};
  const set = {service: c.service, actions: actions.filter((a) => !RUN_ACTIONS.includes(a.name)), settings};
  const root = {...c, set: m.set, set_title: `Set ${m.set}`, config: json(runs), title_json: JSON.stringify(c.title), manifest: JSON.stringify(manifest(m), null, 2)};
  for (const name of RUNS_FILES) files[`cockpit/${c.app}/${published(name)}`] = (await renderRecipe(root, `recipes/l3-cockpit/${name}`)).text;
  for (const name of ["Series.js", "Live.js"]) files[`cockpit/${c.app}/${name}`] = readFileSync(`recipes/l3-cockpit/${name}`, "utf8");
  const openRuns = `/sap/opu/odata/sap/${c.service}/RunSet/$count?$filter=${OPEN.replaceAll(" ", "%20")}`;
  files[`cockpit/${c.app}/cockpit.json`] = JSON.stringify({app: c.app, title: `Runs ${m.set}`, service: c.service,
    files: [...RUNS_FILES.map(published), "Series.js", "Live.js"],
    tile: {type: "dynamic", subtitle: c.title, icon: "sap-icon://process", serviceUrl: openRuns, serviceRefreshInterval: "30", numberUnit: "open"}}, null, 2) + "\n";
  const setRoot = {...root, config: json(set), manifest: JSON.stringify(setManifest(m), null, 2)};
  for (const name of SET_FILES) files[`cockpit/${c.set_app}/${published(name)}`] = (await renderRecipe(setRoot, `recipes/l3-cockpit/set/${name}`)).text;
  files[`cockpit/${c.set_app}/Live.js`] = readFileSync("recipes/l3-cockpit/Live.js", "utf8");
  files[`cockpit/${c.set_app}/cockpit.json`] = JSON.stringify({app: c.set_app, title: `Set ${m.set}`, service: c.service,
    files: [...SET_FILES.map(published), "Live.js"],
    tile: {subtitle: "Settings, schedule, kill switch, doctor", icon: "sap-icon://action-settings"}}, null, 2) + "\n";
  return files;
}
function setManifest(m) {
  const id = `l3.${m.set}.set`;
  return {_version: "1.59.0", "sap.app": {id, type: "application", title: "{{appTitle}}", description: "{{appDescription}}", i18n: "i18n/i18n.properties",
    dataSources: {mainService: {uri: `/sap/opu/odata/sap/${m.cockpit.service}/`, type: "OData", settings: {odataVersion: "2.0"}}},
    crossNavigation: {inbounds: {[`${m.cockpit.set_app}-manage`]: {semanticObject: m.cockpit.set_app, action: "manage", signature: {parameters: {}, additionalParameters: "allowed"}}}}},
    "sap.ui": {technology: "UI5", deviceTypes: {desktop: true, tablet: true, phone: true}},
    "sap.ui5": {rootView: {viewName: `${id}.Set`, type: "XML", async: true, id: "set"},
      dependencies: {minUI5Version: "1.120.0", libs: {"sap.m": {}}},
      models: {i18n: {type: "sap.ui.model.resource.ResourceModel", settings: {bundleName: `${id}.i18n.i18n`, supportedLocales: [""], fallbackLocale: ""}},
        "": {dataSource: "mainService", preload: true, settings: {useBatch: false, defaultCountMode: "None", defaultBindingMode: "OneWay"}}}}};
}
// a run's actions sit in its header and show only when the run's state allows them
// (applicablePath: a boolean the DPC computes); a pile's release is a table action,
// enabled only for a selected HELD pile
function runActions(m) {
  const names = cockpitActions(m).map((a) => a.name), out = {};
  for (const [name, path] of [["ContinueGlass", "CanContinue"], ["Resume", "CanResume"]]) {
    if (names.includes(name)) out[name] = {id: name, text: `{{${name}}}`, press: `ask${name}`, applicablePath: path};
  }
  return out;
}
function pileActions(m) {
  if (!cockpitActions(m).some((a) => a.name === "ReleasePile")) return {};
  return {Pile: {id: "Pile", Actions: {ReleasePile: {id: "ReleasePile", text: "{{ReleasePile}}", press: "askReleasePile",
    requiresSelection: true, applicablePath: "CanRelease"}}}};
}
function manifest(m) {
  const id = `l3.${m.set}`;
  const actions = Object.fromEntries(cockpitActions(m).filter((a) => a.name === "StartRun")
    .map((a) => [a.name, {id: a.name, text: `{{${a.name}}}`, press: `ask${a.name}`, requiresSelection: false, global: true}]));
  const list = "sap.suite.ui.generic.template.ListReport.view.ListReport", details = "sap.suite.ui.generic.template.ObjectPage.view.Details";
  return {_version: "1.59.0", "sap.app": {id, type: "application", title: "{{appTitle}}", i18n: "i18n/i18n.properties",
    dataSources: {mainService: {uri: `/sap/opu/odata/sap/${m.cockpit.service}/`, type: "OData", settings: {odataVersion: "2.0"}}},
    crossNavigation: {inbounds: {[`${m.cockpit.app}-manage`]: {semanticObject: m.cockpit.app, action: "manage", signature: {parameters: {}, additionalParameters: "allowed"}}}}},
    "sap.ui": {technology: "UI5", deviceTypes: {desktop: true, tablet: true, phone: true}},
    "sap.ui5": {dependencies: {minUI5Version: "1.120.0", libs: {"sap.m": {}, "sap.ui.generic.app": {}, "sap.suite.ui.generic.template": {}, "sap.suite.ui.microchart": {lazy: true}}},
      models: {cockpitI18n: {type: "sap.ui.model.resource.ResourceModel", settings: {bundleName: `${id}.i18n.i18n`, supportedLocales: [""], fallbackLocale: ""}},
        "": {dataSource: "mainService", preload: true, settings: {useBatch: false, defaultCountMode: "Inline", defaultBindingMode: "OneWay"}}},
      extends: {extensions: {
        "sap.ui.controllerExtensions": {
          [list]: {controllerName: `${id}.List`, "sap.ui.generic.app": {RunSet: {EntitySet: "RunSet", Actions: actions}}},
          [details]: {controllerName: `${id}.Cockpit`, "sap.ui.generic.app": {RunSet: {EntitySet: "RunSet", Header: {Actions: runActions(m)}, Sections: pileActions(m)}}}},
        // the progress section comes first: what a person opens a run page for
        "sap.ui.viewExtensions": {[details]: {"BeforeFacet|RunSet|Stage": {
          className: "sap.ui.core.Fragment", fragmentName: `${id}.Cockpit`, type: "XML", "sap.ui.generic.app": {title: "{{progress}}"}}}}}}},
    "sap.ui.generic.app": {_version: "1.3.0", settings: {flexibilityEnabled: false}, pages: {"ListReport|Run": {entitySet: "RunSet", component: {
      name: "sap.suite.ui.generic.template.ListReport", list: true, settings: {dataLoadSettings: {loadDataOnAppLaunch: "always"}, smartVariantManagement: false,
        // no variant called "Standard": the page is titled by its set
        variantManagementHidden: true}},
      pages: {"ObjectPage|Run": {entitySet: "RunSet", component: {name: "sap.suite.ui.generic.template.ObjectPage", settings: {editableHeaderContent: false, tableSettings: {variantManagement: false}}}}}}}}};
}
