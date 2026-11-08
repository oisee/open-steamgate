// A namespaced DDIC name in the two places a generator writes it.
//
// /DMO/CURRHLP is written the way abapGit writes it, #dmo#currhlp (a slash
// in a file name would be a directory), and is a word inside a generated
// identifier, ZCL_STG_CDS_DMO_CURRHLP (a slash would not be an ABAP class
// name). Measured before this existed: the first namespaced CDS view in a
// pack made tools/cds2ddic.mjs write gen/cds/dmo/... and fail with ENOENT
// (packs/rap-flight, 2026-11-08). An unnamespaced name passes through.
export const fileOf = (name) => name.toLowerCase().replace(/\//g, "#");
export const wordOf = (name) => name.toUpperCase().replace(/^\/(\w+)\//, "$1_");
