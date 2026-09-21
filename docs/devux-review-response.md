# Response to the DevUX architecture review

Status: resolved against the 2026-09-21 review and addendum.

The adversarial review is retained beside the rendered architecture. This file
records which findings changed the plan so that the review and the decision do
not silently contradict one another.

| Finding | Resolution |
|---|---|
| one active generation hides source/live/serving | accepted; the state machine and acceptance gate now show all three identities and recycle |
| cross-surface visibility and locks were asserted | accepted; source visibility is separated from serving state, and concurrent conflict behavior is an acceptance test |
| CodeMirror chosen by adjective | accepted; CodeMirror is only the leading candidate, measured against Monaco inside OpenUI5 |
| capability contract risks a second registry | accepted; it is now a derived view over node inventory, build identity and destinations |
| Pages activation treated as routine | accepted; deferred to a measured feasibility track |
| Pages fully offline claim | accepted; only shell/precached fixtures are claimed initially |
| IndexedDB/OPFS over-promised | accepted; storage is optional/evictable and Export Patch is the recovery boundary |
| user and ordering absent | accepted; primary users and relative uncertainty are now explicit |
| Workbench registry/BSP integration absent | accepted; OSG pack node and SAP BSP/child-SICF shapes are stated |
| loopback bind stated rather than verified | accepted; listener addresses are verified before readiness |
| existing RFC record/replay ignored | accepted with a boundary; target/mode/provenance concepts are shared, typed RFC and raw HTTP executors stay protocol-specific |
| agent agreement called independent evidence | accepted as a wording correction; correlated readings are not validation, GW0 is |
| leak scan loses private identifiers in worktrees | accepted and fixed by resolving Git's common checkout |
| GW0 could imply standing A4H permission | accepted; each concrete A4H run still requires Alice's explicit authorization |
| Run/LUW rule existed only in chat | already resolved before the addendum: the Gateway plan has a dedicated Transaction and isolation section |

No calendar estimates are invented before the spikes. The architecture records
relative uncertainty and a measurable gate for each track; observed work can
replace those labels with actual delivery data later.

