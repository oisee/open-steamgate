// Object names, types and class includes shared by the local object store.
// abapGit writes /DEMO/ZREPORT as #demo#zreport; ADT hands us the name
// with its slashes, URL-encoded, and the façade decodes before it gets here
export const fileOf = (name) => name.toLowerCase().replaceAll("/", "#");
export const nameOf = (file) => file.toUpperCase().replaceAll("#", "/");

// the object types wave 1 reads, with the extension abapGit gives them and
// the ADT resource they live under
export const TYPES = {
  CLAS: {ext: ".clas.abap", adt: "oo/classes", source: true},
  INTF: {ext: ".intf.abap", adt: "oo/interfaces", source: true},
  PROG: {ext: ".prog.abap", adt: "programs/programs", source: true},
  FUGR: {ext: ".fugr.xml", adt: "functions/groups", source: false},
  TABL: {ext: ".tabl.xml", adt: "ddic/tables", source: false},
  DTEL: {ext: ".dtel.xml", adt: "ddic/dataelements", source: false},
  DOMA: {ext: ".doma.xml", adt: "ddic/domains", source: false},
  TTYP: {ext: ".ttyp.xml", adt: "ddic/tabletypes", source: false},
  DDLS: {ext: ".ddls.asddls", adt: "ddic/ddl/sources", source: true},
  SRVD: {ext: ".srvd.srvdsrv", adt: "ddic/srvd/sources", source: true},
  VIEW: {ext: ".view.xml", adt: "ddic/views", source: false},
  SHLP: {ext: ".shlp.xml", adt: "ddic/searchhelps", source: false},
  MSAG: {ext: ".msag.xml", adt: "messageclass", source: false},
  SICF: {ext: ".sicf.xml", adt: "sicf", source: false},
  SAPC: {ext: ".sapc.xml", adt: "apc", source: false},
  SAMC: {ext: ".samc.xml", adt: "amc", source: false},
  DEVC: {ext: ".devc.xml", adt: "packages", source: false},
  // an include is a program without a header; abapGit gives both the same
  // extension, so the two are told apart by what the source starts with
  INCL: {ext: ".prog.abap", adt: "programs/includes", source: true, sameFileAs: "PROG"},
};

// vsp asks for a structure under ddic/structures and for a table under
// ddic/tables, but abapGit writes both as .tabl.xml and the difference is
// TABCLASS inside: INTTAB is a structure, TRANSP and friends are tables
export const STRUCTURE_TABCLASS = "INTTAB";

// a class carries more than one file; ADT calls them includes
export const INCLUDES = {
  main: ".clas.abap",
  definitions: ".clas.locals_def.abap",
  implementations: ".clas.locals_imp.abap",
  macros: ".clas.macros.abap",
  testclasses: ".clas.testclasses.abap",
};
