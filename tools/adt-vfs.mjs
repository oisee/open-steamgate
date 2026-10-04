import {requestElements, elementsNamed, attributeValue, namespaces} from "./adt-request-xml.mjs";
// Live Node VFS renderer: the independent oracle for the ABAP port.
import {TYPES} from "./osd-store-types.mjs";
import {ADT_TYPE, TREE_FOLDER, TREE_CATEGORY, TREE_TYPE_LABEL, TREE_CATEGORY_LABEL} from "./adt-documents.mjs";
const BASE = "/sap/bc/adt";
export function virtualFoldersDocument(store, xml) {


  // What the facets call things. The type facet uses REPO for a program
  // (a4h-adt.jsonl:239, "Programs"), and the group facet puts CDS under its
  // own drawer rather than the dictionary (a4h-adt.jsonl:141). Everything
  // else is the workbench's own category and label tables, so a drawer here
  // and a drawer in nodestructure are named by one place.
  const vfsType = (type) => type === "PROG" ? "REPO" : type;
  const vfsTypeLabel = (value) => {
    const kind = value === "REPO" ? "PROG" : value;
    return TREE_FOLDER[kind]?.[1] ?? TREE_TYPE_LABEL[kind] ?? value;
  };
  const CDS = ["DDLS", "SRVD", "DCLS"];
  const vfsGroup = (type) => CDS.includes(type) ? "CORE_DATA_SERVICES" : (TREE_CATEGORY[type] ?? "other").toUpperCase();
  const GROUP_LABELS = {CORE_DATA_SERVICES: "Core Data Services", UC_OBJECT_TYPE_GROUP: "Connectivity"};
  const vfsGroupLabel = (value) => GROUP_LABELS[value] ?? TREE_CATEGORY_LABEL[value.toLowerCase()] ?? value;

  const virtualFoldersRequest = (xml) => {
    const elements=requestElements(xml),preselection=new Map();
    for (const element of elementsNamed(elements,namespaces.vfs,"preselection")) {
      const facet=attributeValue(element,"","facet"); if (!facet) continue;
      preselection.set(facet.toLowerCase(),elementsNamed(elements,namespaces.vfs,"value",elements.indexOf(element)+1).map(e => e.text.toUpperCase()));
    }
    const order=elementsNamed(elements,namespaces.vfs,"facet").map(e => e.text.toLowerCase()).filter(Boolean);
    const root=elementsNamed(elements,namespaces.vfs,"virtualFoldersRequest")[0];
    const pattern=attributeValue(root,"","objectSearchPattern") ?? "*";
    return {preselection,order,pattern};
  };

  // Every object this façade holds, with the package it sits in.
  const everyObject = () => {
    const all = [];
    for (const pkg of store.packages()) {
      for (const object of store.package(pkg.name).objects) {
        all.push({...object, package: pkg.name});
      }
    }
    return all;
  };

  // The package tree, for the two spellings a selection has. A plain name
  // means the package and everything below it (a4h-adt.jsonl:44: $ZORK
  // counts 24, which is its subpackages' objects); a name with ".." in
  // front means only what is assigned to that package directly
  // (a4h-adt.jsonl:233: ..Z counts 2 where Z counted 8).
  const packageTree = () => {
    const byName = new Map(store.packages().map((p) => [p.name, p]));
    const subtree = (name) => {
      const out = [name];
      for (let i = 0; i < out.length; i++) {
        for (const child of byName.get(out[i])?.subpackages ?? []) {
          out.push(child);
        }
      }
      return out;
    };
    return {byName, subtree};
  };
  const packageMembers = (value, tree) =>
    value.startsWith("..") ? [value.slice(2)] : tree.subtree(value);

  const matchesPattern = (name, pattern) => {
    if (pattern === "" || pattern === "*") {
      return true;
    }
    const escaped = pattern.toUpperCase().split("*")
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${escaped}$`).test(name.toUpperCase());
  };

  // The value of a facet for one object. Two facets have no value here and
  // say so: "api" is the release contract of an object, which this façade
  // does not hold, and inventing one would tell a cloud project every object
  // is released; "fav" is a person's favourite packages, which the system
  // itself answers empty for (a4h-adt.jsonl:32). An empty drawer is the
  // honest answer for both.
  const facetValue = (object, facet) => {
    if (facet === "package") {
      return object.package;
    }
    if (facet === "type") {
      return vfsType(object.type);
    }
    if (facet === "group") {
      return vfsGroup(object.type);
    }
    return undefined;
  };

  const xmlEscape = (text) => String(text)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const ATOM = ' xmlns:atom="http://www.w3.org/2005/Atom"';
  const SELECTION_REL = "http://www.sap.com/adt/relations/informationsystem/virtualfolders/selection";
  const selectionHref = (parts) =>
    `${BASE}/repository/informationsystem/virtualfolders?selection=${encodeURIComponent(parts.join(" "))}`;

    const asked = virtualFoldersRequest(xml);
    const tree = packageTree();
    const packageValues = asked.preselection.get("package") ?? [];

    let objects = everyObject().filter((object) => matchesPattern(object.name, asked.pattern));
    for (const [facet, values] of asked.preselection) {
      if (facet === "package") {
        const members = new Set(values.flatMap((value) => packageMembers(value, tree)));
        objects = objects.filter((object) => members.has(object.package));
      } else {
        objects = objects.filter((object) => values.includes(facetValue(object, facet)));
      }
    }
    const countIn = (names) => {
      const set = new Set(names);
      return objects.filter((object) => set.has(object.package)).length;
    };

    const selected = [...asked.preselection].map(([facet, values]) => `${facet}:${values.join(",")}`);
    const rootLink = `<atom:link href="${selectionHref(selected)}" rel="${SELECTION_REL}" title="Virtual Folder Selection"${ATOM}/>`;

    // Exactly one package, spelled plainly, and the client is told whether
    // that package has packages below it — which is how it decides whether
    // to ask for a package level next (:44 true, :90 false) — and nothing
    // for several packages (:231) or the direct-only spelling (:233).
    const onePackage = packageValues.length === 1 && !packageValues[0].startsWith("..") ? packageValues[0] : undefined;
    const hasSubpackages = (name) => (tree.byName.get(name)?.subpackages?.length ?? 0) > 0;
    const preselectionInfo = onePackage === undefined ? "" :
      `<vfs:preselectionInfo facet="PACKAGE" hasChildrenOfSameFacet="${hasSubpackages(onePackage)}"/>`;

    let body;
    if (asked.order.length === 0) {
      // The objects. The system also carries a vituri and a second link
      // into SAP GUI for HTML; nothing here answers those, and a link that
      // 404s is worse than one that is absent.
      body = objects.map((object) => {
        const type = TYPES[object.type];
        const uri = `${BASE}/${type?.adt ?? "unknown"}/${encodeURIComponent(object.name.toLowerCase())}`;
        return `<vfs:object uri="${uri}" text="${xmlEscape(object.description ?? object.name)}" name="${xmlEscape(object.name)}"` +
          ` package="${xmlEscape(object.package)}" type="${ADT_TYPE[object.type] ?? object.type}" expandable="${type?.source === true}">` +
          `<atom:link href="${uri}" rel="http://www.sap.com/adt/relations/objects" title="ADT Object Reference"${ATOM}/>` +
          "</vfs:object>";
      }).join("");
    } else if (asked.order[0] === "package") {
      // Package drawers. One selected package opens to its subpackages,
      // with a "..P" drawer first when P holds objects of its own (:232 has
      // one, :44 does not); several selected packages open to themselves
      // (:231); no package at all opens to the roots, which no capture
      // shows and is this façade's reading of what a root should be.
      const others = selected.filter((part) => !part.startsWith("package:"));
      const drawer = (name, direct) => {
        const pkg = tree.byName.get(name);
        const value = direct ? `..${name}` : name;
        const uri = `${BASE}/packages/${encodeURIComponent(name.toLowerCase())}`;
        return `<vfs:virtualFolder hasChildrenOfSameFacet="${!direct && hasSubpackages(name)}" uri="${uri}"` +
          ` counter="${countIn(packageMembers(value, tree))}"` +
          ` text="${xmlEscape(direct ? "directly assigned objects" : (pkg?.description ?? ""))}"` +
          ` name="${xmlEscape(value)}" displayName="${xmlEscape(value)}" facet="PACKAGE">` +
          `<atom:link href="${selectionHref([...others, `package:${value}`])}" rel="${SELECTION_REL}" title="Virtual Folder Selection"${ATOM}/>` +
          `<atom:link href="${uri}" rel="http://www.sap.com/adt/relations/packages" title="Package"${ATOM}/>` +
          "</vfs:virtualFolder>";
      };
      let drawers;
      if (onePackage !== undefined) {
        const own = objects.some((object) => object.package === onePackage);
        drawers = [...(own ? [drawer(onePackage, true)] : []),
          ...[...(tree.byName.get(onePackage)?.subpackages ?? [])].sort().map((child) => drawer(child, false))];
      } else if (packageValues.length === 0) {
        drawers = store.rootPackages().map((root) => root.name).sort().map((name) => drawer(name, false));
      } else {
        drawers = packageValues.map((value) => value.startsWith("..") ? drawer(value.slice(2), true) : drawer(value, false));
      }
      body = drawers.join("");
    } else {
      // Group and type drawers: the objects of the selection, counted by the
      // facet, each drawer linking to the selection narrowed by itself.
      const facet = asked.order[0];
      const counts = new Map();
      for (const object of objects) {
        const value = facetValue(object, facet);
        if (value !== undefined) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      body = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => {
        const label = facet === "group" ? vfsGroupLabel(value) : facet === "type" ? vfsTypeLabel(value) : value;
        return `<vfs:virtualFolder hasChildrenOfSameFacet="false" counter="${count}" text=""` +
          ` name="${xmlEscape(value)}" displayName="${xmlEscape(label)}" facet="${facet.toUpperCase()}">` +
          `<atom:link href="${selectionHref([...selected, `${facet}:${value}`])}" rel="${SELECTION_REL}" title="Virtual Folder Selection"${ATOM}/>` +
          "</vfs:virtualFolder>";
      }).join("");
    }

    return (
      '<?xml version="1.0" encoding="utf-8"?>' +
      `<vfs:virtualFoldersResult objectCount="${objects.length}"` +
      ' xmlns:vfs="http://www.sap.com/adt/ris/virtualFolders">' +
      preselectionInfo + rootLink + body +
      "</vfs:virtualFoldersResult>"
    );
}
