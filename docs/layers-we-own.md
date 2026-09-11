# Layers we already own

open-steamgate is not starting from zero on the SAP-protocol side. Its sibling
projects have already reverse-engineered and, in most cases, live-proven several
layers of the SAP stack. This page indexes what carries over, so a piece of work
here starts from what is proven instead of re-deriving it.

Two siblings are **public** and can be depended on directly:

- **[vsp / vibing-steampunk](https://github.com/oisee/vibing-steampunk)** — Go
  MCP server + CLI for ABAP Development Tools (ADT).
- **[open-rfc-go](https://github.com/oisee/open-rfc-go)** — pure-Go NI / RFC /
  CPIC transport.

Two further siblings are **private** — a DIAG-protocol project (which carries
the SAP-LZH *writer*) and a shared SAP knowledge base. Their reusable protocol
facts are summarized here; their repository URLs are deliberately not tracked in
this public repo.

Maturity: **ready** = proven by tests and/or against a real system · **partial**
= works but narrow or unmerged · **missing/design** = not built.

---

## Directly relevant to open-steamgate

| Layer | State | Where | Note for open-steamgate |
|---|---|---|---|
| **SAP-LZH / LZC decode** | ready | vsp `pkg/sapcompress` | Decode-only. 2-bit prefix + raw DEFLATE (via `compress/flate`); LZC is compress(1)-style LZW. Relevant if any seed/export path arrives SAP-compressed. |
| **SAP-LZH encode (writer)** | partial | private DIAG sibling | Round-trips against `sapcompress`; the exact-length Huffman-only writer that a live SAP kernel accepts on the C→S path. Not needed for the OData substrate itself, but the definitive reference for how SAP frames DEFLATE. |
| **EXPORT data-cluster decode** | ready | vsp `pkg/datacluster` | Parses INDX/BALDAT/STXL/EUFUNC/… clusters: header, optional LZH/LZC body, typed row decode (all elementary types, nested structures, tables-in-rows, out-of-line strings), v5 + v6. **This is the closest existing analog to reading real table data out of a system** — a complement to the abapGit TABU path for seed data. |
| **ADT transport** (auth, CSRF, session affinity, locks, CORRNR) | ready | vsp `pkg/adt` | Session-affinity + lock/CORRNR reuse rules. The deploy-back / read-from-system last mile is already vsp's job; open-steamgate does not re-implement it. |
| **abapGit / `ZADT_VSP` bridge** | partial | vsp | Transport merge/move via a function bridge; the blessed path into a real system. Seed-data capture and code deploy-back ride this, not a direct SAP API. |
| **DDIC layout** (DD03L → field names/types) | ready | vsp `pkg/adt` (`ddic_layout.go`) | Lays DDIC names over numbered cluster fields. Useful cross-check when generating the local SQLite schema from DDIC. |

## Transport / protocol layers (context, not on the critical path)

| Layer | State | Where |
|---|---|---|
| NI framing (encode/decode, PING/PONG) | ready | open-rfc-go `pkg/ni` |
| RFC client handshake (CPIC password logon) | ready | open-rfc-go `pkg/rfc` |
| RFC type-3 server | partial | open-rfc-go `pkg/rfc` |
| Framing proxy / sniffer (JSONL capture) | ready | open-rfc-go `pkg/sniffer` |
| DIAG header/items, DYNT_ATOM screens, classic list, ALV row-blob | ready | private DIAG sibling |
| SNC / GSS / Kerberos | design only | private KB |

---

## What this means for the build

- **Seed data has two proven readers.** The blessed path is abapGit Data Config
  (TABU JSON) → `load-table-contents` → SQLite. Where a table is not TABU-
  exportable, vsp's `pkg/datacluster` already decodes `EXPORT ... TO DATABASE`
  cluster images and vsp's freestyle-SQL/data-preview reads live rows — either
  can produce the one-time seed dump a human/agent captures.
- **Deploy-back is not this repo's problem.** Code push-back into a real system
  is abapGit deserialize, already vsp's territory. open-steamgate stops at
  producing the artifacts; vsp/abapGit carry them the last mile.
- **We know how SAP frames its bytes.** If any part of the pipeline meets
  SAP-compressed or clustered data, the decoders exist and are live-proven —
  don't re-derive them.

Cross-repo reuse conventions (the `replace` mesh, capture hygiene, confirmed-vs-
inferred marking) follow the shared knowledge base in the private KB sibling.
