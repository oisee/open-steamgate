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

## The ADT versions feed

Eclipse's Revision History and "Compare With", and vsp's revisions, read the
same git history over ADT (`tools/adt-versions.mjs`, routes in
`tools/adt-facade.mjs`).

- **Where.** A program, include or other source object (not yet a function module):
  `<object>/source/main/versions`. A class, per include:
  `<class>/includes/<main|definitions|implementations|macros|testclasses>/versions`,
  and an interface at `includes/main/versions` (where vsp asks). A CDS source
  also answers at `<object>/versions`. A class include that has no file of its
  own has `00000` only, never its main include's history.
- **Linked where A4H links it.** The program document and each class include
  carry `<atom:link href="…/versions" rel="http://www.sap.com/adt/relations/versions"/>`
  as their first link, with no type, title or `adtcore` attribute; a CDS source
  links `versions`. This placement is read off the recorded A4H corpus, which
  has no interface document, so an interface carries no link yet (vsp asks
  `includes/main/versions` directly; abap-adt-api needs the link).
- **Numbering, as measured on A4H** (a local object has one version, 00000,
  the active source, dated at its last activation). Here:
  - `00000` is the working tree. Its date and author are the last commit's when
    the file is unchanged since, otherwise the file's modification time and the
    system's user.
  - Each commit that changed the file is `00001`..`n`, oldest first, so a number
    stays with its commit as history grows. The title is the commit subject.
  - An object git has no history for has `00000` only, the way a local object
    on a system does, and the response says why in `X-OSD-History`.
- **Each version** reads back at `<feed>/<yyyymmddhhmmss>/<nnnnn>/content` as
  `text/plain`: the URI shape A4H writes. The segment selects nothing, the number
  does; a number the feed does not list is 404, never the active source.
- **Checked against a raw A4H capture** (foreman-dell, 2026-09-30): the response
  header `application/atom+xml;type=feed`, and the root and the `00000` entry
  byte for byte. That means one line with no whitespace, `adtcore` declared and
  unused, the title `Version List of <NAME> (<TYPE>)` (`REPS` for a program,
  `CLAS` for a class include), and the feed's own `atom:updated` and the `00000`
  segment fixed at `1970-01-01T10:11:23Z` / `19700101101123`. The entry has
  author, content, id, updated, in that order, with no title and no link, and
  its `atom:updated` is the real date.
- **Design, not oracle: the commit entries.** A4H has no transported version to
  measure, so an entry for `00001`..`n` is the same shape plus the commit
  subject as `atom:title` and the commit's own time in the segment. No transport
  link is written, since the facade serves no transport requests and a link that
  404s is worse than none.

## Next, on the same service

- **`SVRS_*` substitutes.** `SVRS_GET_VERSION_DIRECTORY_46` and `SVRS_GET_REPS_FROM_OBJECT` return VRSD-shaped rows: version 00000 as the active one, commits as 00001..n like the feed, the short SHA in `KORRNUM` (A4H writes `LOCAL` there for a local object), `VERSMODE` `U`. They are built on the lazy table providers once that ADR is accepted.

Tests: `test/store-history.mjs` and `test/adt-versions.mjs` (Node), `store_history_test.go` (Go), and `test/unit/zcl_osd_versions_test` (ABAP, on both hosts).
