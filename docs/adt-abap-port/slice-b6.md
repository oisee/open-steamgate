# B6: quick search and virtual folders

## Decision

Bulk lists cross STORE as LF-delimited records with TAB-delimited fields,
in host order, through EV_SOURCE. PACKAGES `format:"lines"` supplies
packages; `format:"vfs-lines"` supplies packages, child edges and raw objects.
SEARCH `format:"lines"` supplies seeded index hits. Descriptions escape
backslash, TAB and LF; `ZCL_OSD_ADT_JS=>UNESCAPE` decodes them. The full
convention is under **Bulk lists: line format** in [port-map.md](port-map.md).
The unused PACKAGES `objects` flag and SYSTEM VFS are removed.

ABAP owns VFS request parsing, Map-style preselection replacement, patterns,
facet filters, package subtree traversal, counters, selection links and XML.
Objects retain host order; package name sorting uses SORT, while group/type
drawers use COLLATE keys. The independent live Node route remains the diff
oracle, including 12-object order and every facet order.

Search avoids bulk ajson parsing, caches type metadata per request and uses
ABAP fast paths for prefix globs and safe ASCII URI components. It preserves
package-first slicing, NaN, seed max*4 and library hits; `/K` yields no hits,
substring matching is case-sensitive, and huge negative limits return zero
before conversion to integer. Unsupported hosts refuse through REQUIRE;
no Go implementation was added.

## Measurement

Full clone fixture: 159 packages, 1,937 objects, Node 26; medians of 20 warm
wire requests after one warm-up. Search's cost test enforces under 10 ms.

| Work | Node | ABAP |
|---|---:|---:|
| Search wire request | 2.14 ms | 9.24 ms |
| VFS wire request, group facet | 80.65 ms | 98.41 ms |
| Full package/object JSON parse (202,026 bytes, diagnostic only) | - | 281.84 ms |

Accepted timings also appear in [port-plan.md](port-plan.md), section 4.
Reproduce with `OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh node_modules/.bin/mocha test/adt-abap-b6-cost.mjs`.
