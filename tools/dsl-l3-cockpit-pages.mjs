// All web assets come from recipes. Paths are relative to the set's output.
import {readFileSync} from "node:fs";
import {renderRecipe} from "./dsl-abap.mjs";
import {cockpitActions} from "./dsl-l3-cockpit-service.mjs";
export async function cockpitPages(m) {
  const c = m.cockpit, prefix = `cockpit/${c.app}`, files = {};
  const conf = {service: c.service, actions: cockpitActions(m).filter((a) => !a.get).map(({name, params, reason}) => ({name, params, reason: !!reason})),
    settings: (m.settings?.entries ?? []).map(({name, default: value, min, max}) => ({name, default: value, min, max})), governor: !!m.governor};
  const root = {...c, list_actions: conf.actions.filter((a) => ["StartRun", "Doctor", "Schedule", "Unschedule"].includes(a.name)), set: m.set, config: JSON.stringify(conf, null, 1).replaceAll("\n", "\n  "), title_json: JSON.stringify(c.title),
    manifest: JSON.stringify(manifest(m), null, 2)};
  for (const name of ["index.html", "Component.js", "manifest.json", "Cockpit.controller.js", "Cockpit.fragment.xml", "List.controller.js", "i18n.properties"]) {
    files[`${prefix}/${name === "i18n.properties" ? "i18n/i18n.properties" : name}`] = (await renderRecipe(root, `recipes/l3-cockpit/${name}`)).text;
  }
  files[`${prefix}/Series.js`] = readFileSync("recipes/l3-cockpit/Series.js", "utf8");
  files[`${prefix}/cockpit.json`] = JSON.stringify({app: c.app, title: c.title, service: c.service}, null, 2) + "\n";
  return files;
}
function manifest(m) {
  const id = `l3.${m.set}`;
  const actions = Object.fromEntries(cockpitActions(m).filter((a) => ["StartRun", "Doctor", "Schedule", "Unschedule"].includes(a.name))
    .map((a) => [a.name, {id: a.name, text: `{{${a.name}}}`, press: `ask${a.name}`, requiresSelection: false, global: true}]));
  return {_version: "1.59.0", "sap.app": {id, type: "application", title: "{{appTitle}}", i18n: "i18n/i18n.properties",
    dataSources: {mainService: {uri: `/sap/opu/odata/sap/${m.cockpit.service}/`, type: "OData", settings: {odataVersion: "2.0"}}},
    crossNavigation: {inbounds: {[`${m.cockpit.app}-manage`]: {semanticObject: m.cockpit.app, action: "manage", signature: {parameters: {}, additionalParameters: "allowed"}}}}},
    "sap.ui": {technology: "UI5", deviceTypes: {desktop: true, tablet: true, phone: true}},
    "sap.ui5": {dependencies: {minUI5Version: "1.120.0", libs: {"sap.m": {}, "sap.ui.generic.app": {}, "sap.suite.ui.generic.template": {}}},
      models: {cockpitI18n: {type: "sap.ui.model.resource.ResourceModel", settings: {bundleName: `${id}.i18n.i18n`, supportedLocales: [""], fallbackLocale: ""}},
        "": {dataSource: "mainService", preload: true, settings: {useBatch: false, defaultCountMode: "Inline", defaultBindingMode: "OneWay"}}},
      extends: {extensions: {"sap.ui.controllerExtensions": {"sap.suite.ui.generic.template.ListReport.view.ListReport": {controllerName: `${id}.List`, "sap.ui.generic.app": {RunSet: {EntitySet: "RunSet", Actions: actions}}}, "sap.suite.ui.generic.template.ObjectPage.view.Details": {controllerName: `${id}.Cockpit`}},
        "sap.ui.viewExtensions": {"sap.suite.ui.generic.template.ObjectPage.view.Details": {"AfterFacet|RunSet|Pile": {
          className: "sap.ui.core.Fragment", fragmentName: `${id}.Cockpit`, type: "XML", "sap.ui.generic.app": {title: "{{cockpit}}"}}}}}}},
    "sap.ui.generic.app": {_version: "1.3.0", settings: {flexibilityEnabled: false}, pages: {"ListReport|Run": {entitySet: "RunSet", component: {
      name: "sap.suite.ui.generic.template.ListReport", list: true, settings: {dataLoadSettings: {loadDataOnAppLaunch: "always"}, smartVariantManagement: false}},
      pages: {"ObjectPage|Run": {entitySet: "RunSet", component: {name: "sap.suite.ui.generic.template.ObjectPage", settings: {editableHeaderContent: false}}}}}}}};
}
