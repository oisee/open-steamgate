// Host facts shared by the reference routes and the STORE SYSTEM seam.
import {join} from "node:path";
import {generatorFoldersOf} from "./osd-packs.mjs";
import {segwRegistrations, registeredServices} from "./segw-registry.mjs";
import {testClassesIn} from "./osd-unit-run.mjs";
import {serviceTree} from "./osd-status.mjs";
export function xrefFact(store, kind, input = {}) {
  switch (kind) {
    case "XREF_WARM": {
      const compiler = store.warm?.().compiler;
      const objects = input.operation === "READERS" ? compiler?.readersOf(input.type, input.name)
        : compiler?.closureOf(input.type, input.name);
      return objects === undefined ? {available: false, limit: input.limit ?? 5000}
        : {available: true, objects, limit: input.limit ?? 5000};
    }
    case "OBJECT_TYPES": {
      const types = new Map(store.list().map(o => [o.name, o.type]));
      return Object.fromEntries((input.names ?? [...types.keys()]).filter(n => types.has(n)).map(n => [n, types.get(n)]));
    }
    case "TESTCLASSES": return testClassesIn(store.root).map(n => n.replace(/\s+\(.*$/, ""));
    case "SERVICE_ROWS": return serviceTree(store.root).map(({path, handler, mpc}) => ({path, handler, mpc}));
    case "SEGW_REGISTRATIONS": {
      const rows = segwRegistrations(generatorFoldersOf(store.root).map(f => join(store.root, f)));
      const registered = new Set(registeredServices(rows));
      return (input.registered ? [...registered] : rows).map(r => ({service: r.service, external: r.external, dpc: r.dpc, mpc: r.mpc, registered: registered.has(r)}));
    }
  }
}
