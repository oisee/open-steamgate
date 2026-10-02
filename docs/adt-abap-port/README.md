# Porting the ADT façade to ABAP

Working documents for ADR 0007 (the façade in ABAP) and ADR 0008 (locks through ENQ). They were generated on
2026-10-01 from origin/main `e359bcf5`, so re-check line numbers against the current tree.

- [port-map.md](port-map.md) is the server side. It covers every route of `tools/adt-facade.mjs` (84 rows, 142
  registrations at runtime), with each route's group and owner, the build order of the skeleton, the minimal host
  interfaces, units of work per group, the documents each group needs, the migration gates, and the risks.
- [client-view-abap-fs.md](client-view-abap-fs.md) is the client side. It shows how the open-source abap-fs /
  abap-adt-api (MIT) call each path, what they parse, where they gate features on discovery, and which paths they
  use that we don't serve.

Clean room: we port our own JavaScript. The contract comes from the wire, from A4H answering us as a client, and from
open-source clients, never from SAP server code or SAP client jars.
