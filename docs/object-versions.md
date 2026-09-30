# Object versions, read out of git

The versions of an ABAP object are the commits that changed its file.
They are stored nowhere else: git answers (ADR 0001, `docs/backlog/adt.md`,
"Versions of an object, read out of git").

## The host service: ZOSD_STORE HISTORY and REVISION

`CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'` gains two commands, on the Node
host (`tools/osd-store-destination.mjs` over `tools/osd-git-history.mjs`) and
the Go host (`tools/gogen/go/abap/store_history.go`):

| command | in | out |
| --- | --- | --- |
| `HISTORY` | `IV_TYPE`, `IV_NAME`, `IV_LIMIT` (default 50) | `ET_REVISION` (`ZOSD_REVISION_S`), newest first; `EV_FILE`; `EV_COUNT` |
| `REVISION` | `IV_TYPE`, `IV_NAME`, `IV_REVISION` (a full 40-character SHA from `HISTORY`) | `EV_SOURCE` (byte-stable), `EV_FILE` (the path in that commit) |

- **The object's file comes from the object store.** It is the file of the winning layer.
- **History follows renames** (`git log --follow`). A version from before a rename is read at the path it had then.
- **A merge that changed the file is a version**, compared with its first parent (`--diff-merges=first-parent`), so the newest version is what HEAD holds even after a resolved conflict. The walk is `--first-parent`: a branch merged in shows as its merge, not as its commits again.
- **A copy begins a history.** `--follow` also follows a copy into its source; a class made by copying another would inherit the other's commits, so the history stops at the commit that made the copy. The same cut applies when one commit moves a file and recreates the old name as a stub: git reports that as a copy, and the moved file's history begins there.
- **`ZOSD_REVISION_S` fields:**
  - `REVISION` (the full SHA) and `SHORT` (12 characters);
  - `AUTHOR`: the commit author (after `.mailmap`) as a SAP-style user name (non-ASCII dropped, then upper case, `A-Z0-9_`, at most 12 characters), never an e-mail;
  - `DATE` and `TIME` in UTC, like a system's `DATUM`/`ZEIT`;
  - `SUBJECT` (80 characters).
- **No history is said out loud.** For an untracked or ignored file, a pack fetched without its `.git`, or a tree that is not a git worktree, `EV_NOTE` says `no history: <reason>` and `EV_COUNT` stays empty. An empty list would read as "never changed".
- **A commit that did not change the file** is not a version of it, and `REVISION` refuses it.

## The ABAP reader: ZCL_OSD_VERSIONS

```abap
zcl_osd_versions=>history( EXPORTING iv_type = `CLAS` iv_name = `ZCL_X`
                           IMPORTING et_revision = lt_versions ev_no_history = lv_why ).
lv_old = zcl_osd_versions=>source_at( iv_type = `CLAS` iv_name = `ZCL_X`
                                      iv_revision = ls_version-revision ).
```

A host without an object store raises `ZCX_OSD_VERSIONS` with "no object store here". That covers a system without the `STORE` destination and a built binary without its tree.

## Next, on the same service

- **ADT versions feed.** `.../source/main/versions`, so Revision History and "Compare with…" work in Eclipse and vsp.
- **`SVRS_*` substitutes.** `SVRS_GET_VERSION_DIRECTORY_46` and `SVRS_GET_REPS_FROM_OBJECT` return VRSD-shaped rows: the short SHA in `KORRNUM`, version 00000 as the active one. Their signatures are measured on A4H first, and they are built on the lazy table providers once that ADR is accepted.

Tests: `test/store-history.mjs` (Node), `store_history_test.go` (Go), and `test/unit/zcl_osd_versions_test` (ABAP, on both hosts).
