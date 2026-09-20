# ICF registry audit fixes, 2026-09-20

The child runtime, inline Node host and browser backend now build their HTTP
route snapshots from ICFSERVICE/ICFHANDLER. Inactive nodes remain explicit
404 barriers, including nodes without a handler; an active descendant of an
inactive node is blocked too. Activation changes take effect at the next
runtime start/recycle, or browser backend restart. The preview worker passes
the /sap/bc branch to that backend so a row-only node can reach it.

Handler selection uses ICFORDER, with ICFTYP as a deterministic tie-breaker,
in both JavaScript and ABAP. Import preserves explicit order from SICF XML.
This still selects the final handler; it does not implement execution of a
multi-handler pipeline or change APC routing.

ICFDOCU descriptions participate in the object hash, including language,
addition and removal. Description row order does not change the hash.
The pre-existing service/handler hash format is otherwise retained.

## Legacy hashes

The old hash recorded no descriptions. If its service/handler digest still
matches, an unchanged seeded description upgrades the hash without replacing
the row. An EDITED row is also preserved, including local descriptions and
activity, while the current source object becomes the new hash baseline.
This one upgrade cannot distinguish a historical local description edit
from a simultaneous incoming description change. Preserving the edited row
is intentional; subsequent description changes use the ordinary drift rule.
Unmarked edits and the lossy ASIDE representation remain existing limits.

## Checks and publishing

Regression tests cover HTTP inactive subtrees, handlerless inheritance,
handler order, description updates against a real database, legacy migration,
and row-only routes through both actual Node hosts with private SQLite files.
The browser suite also checks saved deactivation after a browser restart.

Six launchpad navigation checks open Travels, Bookings, Flight analytics,
SEGW, ICF services and System status, with visible application content.
The same cases run against Node and the static preview. Main CI and preview
CI remain separate. Pages publication follows successful build/browser
checks; a failed candidate does not replace the previous deployment.

## APC implementation inventory

APC applications now have a separate read-only `ZOSD_ICF_APC` inventory linked
to their SICF node. The object page shows application ID, implementation class
and stateful flag under WebSocket (APC), distinct from HTTP handlers. Missing
node descriptions can be sourced from SAPC. This is source-derived metadata,
refreshed even when the SICF object is KEEP; it does not move WebSocket dispatch
to the editable HTTP registry or implement dynamic APC activation.

After these additions and final fixes: full integration 1231 passing / 3
HANA-dependent pending (exit 0), ABAP Unit OK (15 classes), Node browser
navigation 6 passing including the Zork implementation-class facet, and Zork
browser tests 5 passing. APC API tests use a dedicated process/private database:
the first combined run exposed shared-test-state interference (empty NodeSet),
then the isolated tests and the entire repeated suite passed. Legacy seeded
description removal is covered even when its empty incoming digest matches the
old hash; EDITED rows retain the conservative migration behavior.

Zork now provides a confirmed fresh-session two-command HTML replay, not a full
victory route. Browser checks exercise real APC/engine and displayed output,
manual continuation, declining reset, and cancellation/reconnect. Main CI runs
Zork alongside launchpad smoke tests. See packs/zork/README.md.

Previous preview results predate the APC/Zork additions; no new preview result
is claimed here. Adding a table changes schema; existing persistent-volume
upgrade behavior needs explicit verification before deployment. The APC metadata
refresh is currently nontransactional, so failure midway may leave an incomplete
inventory; startup fails rather than claiming that the registry is ready.

## Additional preview finding

A supplementary reset check (after restarting with saved ICF activity)
returned HTTP 500 from /__preview/reset, with a TypeError inside the bundled
SQL.js asm code; subsequent requests hung. Saved deactivation itself worked.
The reset defect's cause and whether it predates this change are not yet
established. Reset recovery is not included in the passing routing claim;
it needs a separate SQL.js/backend lifecycle investigation. Main Node hosts
do not use this browser reset path.
