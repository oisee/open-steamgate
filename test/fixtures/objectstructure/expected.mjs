import {name} from "./source.mjs";
// Hand-entered protocol facts measured on A4H 7.58. These coordinates are
// independent of abaplint and of the implementation's range conversion.
const link = (rel, source, coordinates, type) => ({rel,
  href: `./${source}#start=${coordinates[0]},${coordinates[1]};end=${coordinates[2]},${coordinates[3]}`,
  ...(type === undefined ? {} : {type})});
const parts = (source, defId, implId, def, impl, type) => [
  ...(defId ? [link("definitionIdentifier", source, defId, type)] : []),
  ...(implId ? [link("implementationIdentifier", source, implId, type === "CLAS/OLD" ? type : undefined)] : []),
  ...(def ? [link("definitionBlock", source, def)] : []),
  ...(impl ? [link("implementationBlock", source, impl)] : []),
];
const method = (n, visibility, level, di, ii, db, ib, owner = name, source = "source/main", test = false) => ({
  name: n, type: owner === name ? "CLAS/OM" : "CLAS/OLD", visibility, level, clif_name: owner,
  ...(test ? {testmethod: "true"} : {}),
  links: parts(source, di, ii, db, ib, owner === name ? "CLAS/OM" : "CLAS/OLD"),
});
export const expected = {
  name, type: "CLAS/OC", visibility: "public",
  links: parts("source/main", [2,6,2,28], [47,6,47,28], [2,0,43,8], [47,0,84,8]),
  children: [
    {name: "IF_OO_ADT_CLASSRUN", type: "CLAS/OR", links: [
      link("definitionIdentifier", "source/main", [7,15,7,33]),
      link("implementationIdentifier", "source/main", [49,9,49,32], "CLAS/OM"),
      link("definitionBlock", "source/main", [7,4,7,33]),
    ]},
    {name: "RUN", type: "CLAS/OB", visibility: "public",
      links: parts("source/main", [9,12,9,15], null, [9,4,9,43])},
    method("GREET", "public", "instance", [12,12,12,17], [55,9,55,14], [12,4,14,42], [55,2,58,11]),
    method("TWICE", "public", "static", [17,18,17,23], [60,9,60,14], [17,4,19,38], [60,2,62,11]),
    method("LONG_SIGNATURE", "public", "instance", [22,12,22,26], [65,9,65,23], [22,4,30,29], [65,2,73,11]),
    method("PROT_HELPER", "protected", "instance", [34,12,34,23], [77,9,77,20], [34,4,35,34], [77,2,79,11]),
    {name: "MV_COUNT", type: "CLAS/OA", visibility: "private", level: "instance",
      links: parts("source/main", [38,9,38,17], null, [38,4,38,24])},
    method("PRIV_HELPER", "private", "instance", [41,12,41,23], [81,9,81,20], [41,4,42,27], [81,2,83,11]),
    {name: "IF_OO_ADT_CLASSRUN~MAIN", type: "CLAS/OM", visibility: "public", level: "instance", clif_name: name,
      links: [link("definitionIdentifier", "source/main", [7,15,7,33], "CLAS/OR"),
        link("implementationIdentifier", "source/main", [49,9,49,32], "CLAS/OM"),
        link("implementationBlock", "source/main", [49,2,51,11])]},
    {name: "LCL_HELPER", type: "CLAS/OCL",
      links: parts("includes/implementations", [5,6,5,16], [13,6,13,16], [5,0,10,8], [13,0,18,8]),
      children: [method("DOUBLE", "public", "static", [7,18,7,24], [15,9,15,15], [7,4,9,32], [15,2,17,11], "LCL_HELPER", "includes/implementations")]},
    {name: "LTCL_PROBE", type: "CLAS/OCL", final: "true", testclass: "true",
      links: parts("includes/testclasses", [3,6,3,16], [14,6,14,16], [3,0,11,8], [14,0,26,8]),
      children: [
        method("FIRST_TEST", "private", "instance", [8,12,8,22], [16,9,16,19], [8,4,8,34], [16,2,18,11], "LTCL_PROBE", "includes/testclasses", true),
        method("SECOND_TEST", "private", "instance", [10,12,10,23], [21,9,21,20], [10,4,10,35], [21,2,25,11], "LTCL_PROBE", "includes/testclasses", true),
      ]},
    {name, type: "CLAS/OCX", extra: {isExternalRef: "true", description: "Text Elements"},
      links: [{rel: "definitionIdentifier", href: "/sap/bc/adt/textelements/classes/zcl_outline_parity_fix"}]},
  ],
};
