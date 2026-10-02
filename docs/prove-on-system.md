# Prove on a system: the same ABAP Unit on OSG and on a sandbox

`tools/osd-prove-on-system.mjs` takes a folder of abapGit-named objects and
puts it on a sandbox system through abapGit. It runs each class's ABAP Unit
there, compares the test methods with OSG, and then deletes exactly what it
brought.

```
node tools/osd-prove-on-system.mjs <folder> --unit <deploy unit> [--manifest m.json]
     [--package $ZOSG_TMP_X] [--keep] [--osg count|run] [--server <mcp server>]
node tools/osd-prove-on-system.mjs --cleanup --package $ZOSG_TMP_X     # needs the run's receipt
```

**Use it on a sandbox only, and never on a productive or customer system.**
The tool imports, runs and deletes. It accepts only a local package (a name
that starts with `$`) and refuses any other name before it sends anything.
It reaches the system through the vsp MCP server that `OSD_MCP_CONFIG`
names (default: `.mcp.json` at the repository root, which is gitignored).
Use `--server`/`OSD_MCP_SERVER` when that file configures more than one
server. No host, user or client name is written in the tool.

## What goes through vsp, and what stays ours

**Minimum vsp: v2.58.0-72** (vibing-steampunk #320: `git_object_versions`
and `expect` on `git_delete_objects`; the import needs v2.58.0-54, #301, and
the JSON `execute_abap`). An older vsp answers `execute_abap` as text and the
tool refuses at the preflight ("the answer is not JSON"); one without
`git_object_versions` is refused at the preflight too, by a read of one
object of the zip before anything is written ("git_object_versions: ... the
conditional delete needs vsp v2.58.0-72"). There is **no fallback to an
unconditional delete**: without the operation the tool does not import, and
a version read that fails at receipt time leaves the objects for a human.
The import and the deletion also need ZADT_VSP with its git service and
abapGit on the system (`vsp install zadt-vsp`; an older ZADT_VSP that does
not say whether an object has an inactive version is refused the same way)
and the `$` package inside vsp's `--allowed-packages`.

| Step | Through | Why |
|---|---|---|
| import (fresh mode) | vsp `git_import_zip` (`overwrite: false`), and `git_import_status` while its job runs | abapGit on the system as a background job; nothing that exists is overwritten, an object of another package refuses |
| versions at receipt time | vsp `git_object_versions` (`sha256: true`) | the sha256 of abapGit's serialisation and the stamp, per object, read right after the import |
| deletion of the run's objects, its repository row, its package | vsp `git_delete_objects`, one call, each object with `expect: {sha256}`, the row with `expect_repo` | vsp checks the version under the lock of its DELETE; see "The deletion is vsp's" |
| residue | vsp `read DEVC <package> {inventory}` **and** our own count, which must agree | two independent reads of the same state |
| ABAP Unit | vsp `test` (its JSON: `ok`, `counts`, `classes`) | the method comparison reads the classes; a run vsp calls not ok fails |
| preflight, the residue count, the class check | our snippets through `execute_abap` | they are the tool's rules, not abapGit's import |
| `--in-place` deploy and restore, its repository row | our own deploy snippet and `dropRepoAbap` | see below |

Every snippet that still runs hands its result back with **one
`RETURN_VALUE( lt_out )`** as its last statement: `lt_out` is a table of
`{k, v}` strings, and vsp serialises it into `result_text` as JSON
(`[{"K":..,"V":..}, ...]`). The last row is `end=OSDPROVE`. The tool reads
nothing out of an alert title any more, and fails closed on:

- an answer that is not JSON (an older vsp, or a cut answer);
- a snippet that did not finish (vsp's `failure`, with the line of the
  snippet where it stopped);
- no value, or more than one;
- a `result_text` that is not JSON (cut), a row that is not `{K, V}` of
  strings, or no end row at the end.

**Why `--in-place` keeps its own deploy.** It must decline the deletes abapGit
plans (the AFTER zip carries no `package.devc.xml`, so abapGit plans to
delete the package's own entry, measured on A4H). vsp's `git_import_zip`
updates an existing object only with `overwrite: true`, and `overwrite`
also requires deletes to be allowed, so the two cannot be had together.
The deploy snippet stays, and only its reporting moved to `RETURN_VALUE`.

**The deletion is vsp's** (it was ours until vsp PR #320, binary v2.58.0-72).
`git_delete_objects` now takes an object as `{"type", "name", "expect":
{"sha256": ...}}` (`stamp` is the coarser alternative; a sha256 decides when
both are given, and a stamp match never overrides a sha256 mismatch). Per
object vsp does LOCK, reads the version under that lock, compares, DELETEs,
UNLOCKs. A mismatch comes back with status `changed` and `observed`, the
object is kept, and so are the repository and the package; an object with an
inactive version takes the sha256 path and comes back `changed` too (the
sha256 covers the active version only). An object map with any other key is
refused. With `delete_repo: true`, `expect_repo {key, name}` makes ZADT_VSP
recheck the row in the step that drops it (`REPO_KEY_MISMATCH` /
`REPO_NAME_MISMATCH`, which vsp reports as the row kept). The tool's cleanup
is one such call, built from the receipt alone (see "The cleanup" below).
It replaced a one-step snippet of ours (with the receipt's stamp, content
hash and XML-canonicalisation rules, which served the same end before vsp
could); the rules moved into vsp, and this tool now only sends what it
saw and reads what vsp saw.

**Residual limit.** vsp goes on with the other objects when one is `changed`
(a delete is per object, not a transaction). So a foreign edit of one object
does not stop the run's other objects from being deleted: the run fails, says
which object was kept, and the repository and the package stay. For this
tool that is fine: every object it deletes is its own and unchanged by the
same test, and the one it keeps is named and listed for a human.

**What changed for the guarantees.**

- The repository row is deleted only when this run's import created it
  (`repoCreated`), checked by key and name in the cleanup's own step. A
  row that is not the run's stays, and so does the package it is registered
  for (the package is deleted only with no repository left registered).
- An import job that did not finish (still pending after the polls, an
  unknown status, a call that broke) skips the cleanup entirely: the job may
  still be writing into the package. The run fails and says to ask
  `git_import_status` and to remove the package by hand.
- The residue check is stronger: besides the TADIR counts, a receipt object
  whose TADIR row is gone must have no REPOSRC / DD rows left, and vsp's
  inventory must list the same objects, subpackages and repository as our
  count.

## It deletes only what it brought, unchanged

The run creates its own package and so owns it:

- The package must not exist when the run starts.
- No object of the zip may exist yet, in any package.
- The run deletes an object only if it is in the run's **receipt** and
  vsp, reading it under the lock of its DELETE, finds it still has the
  receipt's sha256 (a re-activation moves a stamp and not the sha256, so it
  is not an edit; a change in the same second is one).
- It deletes only its own repository row: the one named `OSDPROVE <package>`
  whose key is the key its own import reported **and** that this import
  created (`repoCreated` in vsp's answer, `repoCreated` in the receipt). A
  receipt written before that field existed never deletes the row; the
  cleanup says so. A refused import's row is removed by vsp itself.
- It deletes the package (created by this run) only when nothing else is in it.

There is no abapGit `purge` and there is no `--reuse`. The zip's object
list alone never authorises a delete. **Objects** need the receipt. The run's
repository row and its empty package are recognised by identity: name and
key, and emptiness.

### The run receipt

Right after an import that was not refused, the run reads
`git_object_versions` (`sha256: true`, at most 500 objects a call) for every
object of the zip and writes `.local/prove-runs/<package>.json` (gitignored;
`OSD_PROVE_RUNS` names another folder). It holds:

- `format: 2`, the package, the repository key and name, and whether this
  run's import created it (`repoCreated`);
- the zip's object list;
- `versions`: for each object that is in the package and has an active
  version only, `{item, devclass, sha256, stamp}`. The **sha256** is the one
  vsp computes over abapGit's serialisation of the object in its main
  language (lower-case hex of the sorted `<file>=<file sha256>` lines); the
  `stamp` (`v2:<tables>:<newest YYYYMMDDHHMMSS>:<rows>:<digest>`) is kept for
  a reader and plays no part in the delete.

An object that is not in the package, has no sha256 (`sha256Error`) or has
an inactive version is not in the receipt: the run reports it ("it will not
be deleted") and fails. Every type vsp can serialise has a sha256; the old
list of kinds with a stamp (and DCLS having none) no longer limits what the
tool can delete. A receipt of format 1 (stamps and content hashes, written by
the snippet version) is refused by `--cleanup` with exit 2 and nothing sent:
it cannot be given to a conditional delete.

**Limits.** The sha256 reads the active version; an edit saved but not
activated makes the object `changed` (vsp says so), which is the safe side.
The sha256 is over abapGit's serialisation: anything abapGit does not
serialise is not in it. The stamp is not used for the decision, so the
one-second blind spot of the old stamp rule is gone, and so is the old
re-activation special case (a re-activation leaves the serialisation as it
was; the XML-canonical comparison and its second cleanup call are not needed,
and not there).

A refused import writes no receipt, and neither does an import whose version
read failed. In both cases the cleanup deletes no object (it names the
package alone, below).

A complete cleanup removes the receipt. An incomplete one keeps it, so that
`--cleanup` can try again.

## The steps

Every step is a separate, small MCP call, because a long call can be cut.
The long ones carry vsp's `timeout` (300 s).

1. **Zip.** The tool lays the folder out the same way as
   `tools/osd-abapgit-zip.mjs`: only objects that the deploy unit lists,
   and the build fails closed on anything else.
   - The zip is written in process (`zipInProcess` in
     `tools/osd-abapgit-zip.mjs`: deflate, sorted paths, fixed timestamp),
     not by the `zip` binary, so the tool spawns no child.
   - A unit that puts no class in the zip fails here, because there is
     nothing to prove.
2. **Preflight.** This step reads only and changes nothing. The run is
   refused (exit 2) in three cases:
   - **The package exists.** The run is refused whether the package is
     empty or not, and whether or not a repository is registered for it.
     The message says how to inspect it (SE80 or ADT, abapGit's
     repository list) and to remove it by hand or pick another
     `--package`.
   - **An object of the zip already exists in TADIR, in any package.** An
     import would take it over. The refusal names each object and its
     package.
   - **vsp cannot do the conditional delete.** One `git_object_versions`
     read of the first object of the zip (no sha256) fails, or does not say
     whether the object has an inactive version: nothing is written.
3. **Package.** The tool runs `create DEVC $X`.
4. **Import.** vsp's `git_import_zip` with the zip as `zip_base64`, the
   package, `repo_name` = `OSDPROVE <package>`, `overwrite: false` and
   `wait_seconds: 300`. abapGit on the system imports it as background job
   `ZVSP_GIT_IMPORT`: an offline repository, `set_files_remote`,
   `deserialize_checks`, `deserialize`, with vsp's policy (an existing
   object is never updated without `overwrite`, an object of another
   package, a package move, data loss or unmet requirements refuse). If the
   job is still running when the call returns, the tool asks
   `git_import_status` up to 20 times, 15 s apart. The answer is judged:
   - `imported` passes; W lines of its log are shown, an E or A line fails;
   - `imported_with_errors`, `refused` and `failed` fail the run, with the
     whole log;
   - any other status (still pending, unknown, missing) fails it, and the
     cleanup is skipped (the job may still be writing);
   - a TADIR row the import wrote into another package fails it;
   - the repository key must be there (else there is no receipt and the
     row is never asked for) and the repository must be named
     `OSDPROVE <package>`.

   Objects can be on the system after `imported`, `imported_with_errors`
   and `failed`, so those get a receipt; `refused` wrote nothing and gets
   none.
5. **Classes.** For each class, the tool reads
   `SEOCLASSDF-WITH_UNIT_TESTS` and the line count of the CCAU include
   (`cl_oo_classname_service=>get_ccau_name`, `READ REPORT`). Every class
   of the zip must have an entry.
6. **ABAP Unit.** For each class, the tool runs `test CLAS X` with
   `include_dangerous`.
   - **The result must be vsp's report.** It must be JSON with `ok` and
     `counts`, list every method (not `only_failures`), its
     `counts.methods` must equal the methods it lists, and it must name a
     test class of that class. Anything else fails.
   - **Methods are compared by identity, not by count.** The set of
     `TESTCLASS->METHOD` names the system ran (case-insensitive) must equal
     the set of `FOR TESTING` methods in the source. With `--osg run`, it
     must equal the set that OSG ran. The run names what is missing on
     either side.
   - **Unnamed method entries.** An entry without a name does not count.
     If such an entry carries an alert, it fails the run as "an unnamed
     test method failed".
   - **Not ok.** A class vsp lists as not run fails; a run vsp calls not ok
     with no failure behind it fails with vsp's note.
   - **A class with no tests on either side is not called.** That means no
     tests on OSG and, by step 5, none on the system (WITH_UNIT_TESTS not
     set, empty CCAU). Its row says so.
   - **Something must run.** If no test method ran on the system at all,
     the run fails because there is nothing to prove.
   - **Known limit: inherited test methods.** The source parse credits a
     test method inherited from an abstract local test class to the class
     that declares it, while ADT names the subclass. Such a class shows as
     a difference, not as a pass.
7. **Cleanup.** One vsp call that changes things, then two reads:
   1. **The delete**, `git_delete_objects` on the package, once:
      - every receipt object as `{type, name, expect: {sha256}}`, with the
        sha256 of the receipt, never one read later;
      - `delete_repo: true` with `expect_repo {key, name}` (the key from
        step 4, the name `OSDPROVE <package>`), **only** when this run's
        import created the repository (`repoCreated`). Otherwise the row
        stays;
      - with no receipt entry (a refused import, no receipt) the call names
        the package itself as its one item, which vsp skips as an item and
        then deletes the package only if it is empty and no repository is
        registered for it.

      The answer is read per object: `deleted` as expected; `changed` (a
      foreign edit, or an inactive version): the object is kept, the run
      fails with vsp's reason ("changed since the import (...): a foreign
      edit; kept"); `failed` (the delete itself failed): named; anything
      else, an object we did not ask about, or an object it did not answer
      for: a problem. A repository that is not the expected one comes back
      as the row kept (`repoNote`) and is reported; its package stays. vsp
      deletes the package last, only when nothing is left and no repository
      is registered for it, and never a subpackage. A call that is refused or
      answers no result fails the cleanup without reading more.
   2. **The residue**, read twice. Our snippet counts the repository rows
      with the run's key, the receipt's objects still in the package, the
      REPOSRC / DD rows of a receipt object whose TADIR row is gone,
      everything else in the package, its subpackages and the package
      itself. vsp's inventory (`read DEVC <package>` with `inventory`) must
      list the same objects, subpackages and repository; an inventory that
      is truncated, has no `objects` or no `subpackages` field (`null` is
      vsp's empty list) or could not check the repositories fails. Anything
      left is a problem: a foreign object or a subpackage keeps the package,
      and they are listed.

   `--keep` skips this step and prints the `--cleanup` command. That
   command needs the receipt. Without one it refuses (exit 2) before it
   connects to anything, and it says how to inspect the package by hand.
   With a receipt, it does the same work with the receipt's objects,
   sha256s, repository key and `repoCreated`, and it removes the receipt
   when the cleanup is complete.

The result is a table:

```
class              | methods on OSG | methods on system | failing on system
```

The tool exits with 1 if any of these happens:

- an import error, or an import that did not finish;
- missing or unreadable evidence;
- a difference in test methods;
- a failing method;
- a refused cleanup;
- anything left after the cleanup.

It exits with 2 on a refusal before anything was written.

The last line says what was established and no more:

- in the default count mode: `system: N tests pass; OSG: N test methods
  counted from source, not run`;
- with `--osg run`: `proved: the same N tests pass on OSG and on the
  system`;
- on any failure: `NOT proved: k problem(s)`.

## The OSG side

By default (`--osg count`), the tool collects the `FOR TESTING` methods of
each class from abaplint's parse of the folder (helper methods are not
included). It does not run them. With `--osg run`, it runs the class through
`tools/osd-unit.mjs` on this runtime. That needs the folder in the build
(`abap_transpile.json`), and any method that fails on OSG also fails the
run. The output states which of the two modes was used.

## What a system catches that OSG does not

The first manual run of this walk (L2 rules on A4H, 2026-10-01, #354) found
two defects that no run here could find:

- **A malformed table XML.** `zosd_l2_cargo.tabl.xml` had no closing
  `</abapGit>`. The transpiler and the runtime never parse that file, but
  abapGit's XML parser rejects it at import. The tool reports this as an
  import log message with type E, together with its text.
- **A class without `WITH_UNIT_TESTS`.** abapGit writes the class, and the
  system creates no CCAU include for it: 0 lines. ADT then runs no test
  class, and the run reports nothing at all, not a failure. OSG runs the
  tests from `.clas.testclasses.abap` no matter what the flag says. The
  method comparison catches this case (for example, 2 methods on OSG and 0
  on the system), and step 5 gives the reason: WITH_UNIT_TESTS is not set
  and there is no CCAU include.

## Tests

`test/prove-on-system.mjs` runs the tool against a fake transport that
models what vsp v2.58.0-72 answers, in the shapes its source gives them:
`execute_abap` as JSON whose `result_text` is the snippet's
`RETURN_VALUE( lt_out )` table, ABAP Unit as `{ok, counts, classes}`,
`git_import_zip` / `git_import_status`, `read DEVC` with `inventory`, and
the two operations of #320: `git_object_versions` (`{package, objects:
[{type, name, package, inPackage, stamp, sha256, sha256Error, files,
inactive}]}`) and `git_delete_objects` with `{type, name, expect}` items and
`expect_repo` (answering `{package, objects: [{type, name, status, reason,
observed}], repoDeleted, repo, repoNote}`, or `{error, result}` as an error
when an object is `changed` or `failed`).

- **The fake reads the real zip.** It reads the zip that the tool hands to
  `git_import_zip`, so the WITH_UNIT_TESTS case comes from the class XML and
  is not a canned answer.
- **The fake models the system state.** It keeps packages with their
  parents, TADIR rows, version stamps, serialised files, inactive versions
  and abapGit repositories. Its delete does what vsp does per object: it
  reads the sha256 of the files at the moment of the call and compares it
  with the item's `expect` (a mismatch is `changed`, the object stays, the
  others still go, the repository and the package stay), and it refuses an
  item without an expectation by an assertion.
- **Some properties are checked as text.** The fake does not execute ABAP.
  So the residue snippet's properties (one `RETURN_VALUE( )` after the end
  row, ASCII) are checked on its text, and every snippet is parsed by
  abaplint inside the shape of vsp's execute wrapper.

The tests cover:

- **Basic runs:** the happy path (the exact call sequence, the zip vsp
  receives, the cleanup's objects and its repository flag);
  `imported_with_errors` and its log; a class without CCAU; a failing test
  method; an object abapGit could not delete; `--keep` followed by
  `--cleanup`; the refusal of a package that does not start with `$`.
- **Preflight refusals:** an existing package (empty, with a foreign object,
  with a repository); a zip object that already exists in another package.
- **The conditional delete:** an object replaced right before the delete is
  `changed` and kept, the other still goes, the repository and the package
  stay; an edit right after the receipt read is not taken for the run's own
  (the versions are read twice in all, the probe and the receipt, never at
  cleanup time); `expect` rides on every object; a stamp that moved with the
  content unchanged is deleted; a change in the same second is kept; an
  inactive version is kept.
- **Cleanup scope:** a foreign object and a subpackage that survive and are
  reported; only the receipt's objects in the call; a zip item found in
  another package; a deleted object whose REPOSRC / DD rows survived; vsp's
  inventory disagreeing with our count, truncated, unable to check the
  repositories, or without its `objects` / `subpackages` field (and `null`
  lists accepted as empty).
- **Repository ownership:** a foreign repository that appears after the
  preflight (vsp refuses the import, nothing is deleted, the package stays);
  a key that changed or a renamed repository (`expect_repo` mismatch: the
  objects go, the row and the package stay); an answer without a key;
  `repoCreated: false` keeps the row and the package; a receipt without
  `repoCreated` never deletes the row.
- **The import's evidence:** no status; W lines shown and passing; an E
  line under `imported`; `refused`, `failed`, `imported_with_errors` and an
  unknown status, each with its log; a refused import gets no receipt even
  when its answer names a repository; a failed import's partial objects are
  cleaned by the receipt; a pending job is polled through
  `git_import_status`, and one that never ends, or a call that broke,
  deletes nothing.
- **The snippets' results:** a `result_text` cut in half, one without its
  end row, an answer in the old text shape, a snippet that died (with its
  line), two values instead of one, rows that are not `{K, V}`.
- **The unit result:** not JSON; the old shape without `ok`/`counts`;
  counts that do not match the listed methods; a failures-only answer; a
  class not run; `ok: false` with nothing named; the class not named;
  nameless entries, with and without an alert; the same count with
  different names; `--osg run` against the methods OSG ran; no class in the
  zip; no test method run.
- **The receipt's sha256 and vsp's conditional delete**
  (`describe("the receipt's sha256 ...")`): the receipt carries the sha256 vsp
  read and its stamp; a re-activation is deleted; a same-second change is
  kept; an inactive version is kept; an object with an inactive version, with
  no sha256 or elsewhere is not in the receipt and is named; an answer that
  does not say whether an object is inactive (an older ZADT_VSP) or that is
  for fewer objects fails closed; **an older vsp is refused before anything
  is written, and no plain delete is ever sent**; a receipt read that fails
  after the probe leaves the objects and sends only the package-only call;
  the delete answer's problems (no result, skipped, unknown status, missing
  or unasked-for objects); a receipt of format 1 is refused; DDLS: a CDS view
  gets a sha256 and is deleted, a changed `.asddls` kept. In
  `test/prove-inplace.mjs` the whole sequence: a fresh `--keep` run, an
  in-place run on its package (the fake re-activates every object a deploy
  writes), then `--cleanup`: deleted by the receipt's sha256; a receipt of
  the older kind refused; one object edited after: kept, the other deleted.
- **The wording of the verdict** in both modes.

No child process is spawned: the fake reads the in-process zip in process.
Each rule was checked to fail when the code it covers is removed or bent. For
the conditional delete: `expect` omitted (28 tests fail), the sha256 read at
cleanup time instead of at receipt (8), a `changed` answer treated as
`deleted` (6), `expect_repo` omitted (5), and a plain delete after an older
vsp (5). Before it: the repository row dropped though not created, the
package deleted with a foreign repository registered, an inventory without
its lists, no end-row check, a cut `result_text` tolerated,
`imported_with_errors` passing, a receipt after a refused import, the
inventory not compared, a not-ok unit run ignored, a cleanup while the job
may run, `repoCreated` ignored, residual REPOSRC / DD rows ignored: each
makes at least one test fail.

## Measured on the sandbox: what abapGit's overwrite list holds

(This was measured with the tool's own import snippet, which vsp's
`git_import_zip` has replaced in the fresh mode; vsp's job applies the same
rule -- an existing object is never updated without `overwrite` -- and
leaves an existing package's own entry as it is. The `--in-place` deploy
snippet still decides on this list itself.)

`deserialize_checks( )` lists every object it would write in `overwrite`, new ones included, each with an
`action` (`zif_abapgit_objects=>c_deserialize_action`: add 1, update 2, overwrite 3, delete 4, delete_add 5,
packmove 6). Because the run creates its package and the preflight finds none of the zip's objects, the import
approves only `add`, plus the package's own `DEVC` entry, which `package.devc.xml` updates (action 2). Any other entry is an object
that appeared after the preflight, so the import is refused and nothing is overwritten. Measured 2026-10-01:
a guard that refused every entry stopped a clean import on the first new class, and one that approved only `add`
stopped it on the run's own package. Both were caught by real runs and are the reason for this rule.

## `--in-place`: prove a rewrite inside an existing package, then roll back

```
node tools/osd-prove-on-system.mjs --in-place --package $ZPKG <folder-with-AFTER> --unit <unit> [--keep]
node tools/osd-prove-on-system.mjs --rollback --package $ZPKG     # needs the snapshot of a --keep run
```

The perimeter is a **snapshot**, not the package (`tools/osd-prove-inplace.mjs`).

1. **Snapshot.** Every TADIR object of the package (no DEVC, no subpackage) is
   serialised with `zcl_abapgit_objects=>serialize`; each file is hashed
   (SHA-256) on the system, fetched in chunks, checked against that hash and
   stored under `.local/prove-runs/<package>-snapshot/` with `snapshot.json`
   (an object's hash is the SHA-256 of its sorted `name=sha256` lines). This is
   the rollback source and replaces the receipt. A repository of somebody else
   in the package, an object that cannot be serialised, or a leftover snapshot
   of an earlier run refuses the run (exit 2).
2. **Perimeter.** Every object of the AFTER zip (built without
   `package.devc.xml`) must be in the snapshot: no new objects, else refused.
   Every object of the snapshot is hashed again and must equal its snapshot
   hash, else refused and nothing is deployed. The deploy snippet serialises
   the objects once more inside the call that deserialises, so nothing slips in
   between.
3. **Deploy.** Through the tool's own offline repository and its own deploy
   snippet, not vsp's `git_import_zip` (see "What goes through vsp" above: an
   update there needs `overwrite`, which needs deletes allowed, and this mode
   must decline the deletes abapGit plans). An overwrite is approved only for
   an item of the AFTER list with action update or overwrite; any other entry,
   any data loss, any other repository refuses the import. Like every snippet,
   it reports through `RETURN_VALUE( lt_out )`.
4. **Tests.** The same comparison as the fresh mode (`proveClasses`).
5. **Rollback, always.** The deployed version's hashes are recorded only if
   abapGit reported a status, and they are not read by a later call: the
   deploy snippet serialises and hashes the AFTER objects again right after
   `deserialize`, in the same dialog step, with the same serialisation and
   SHA-256 lines as the hash snippet (`dep_file=` / `dep_obj=` in its report).
   A separate read after the call returned would record a colleague's save in
   that gap as this run's output, and the rollback would then overwrite it.
   Each object is then decided file by file, and is recorded as this run's
   only when every file passes one of:
   (a) its in-step hash equals the zip's file;
   (b) read back by chunks (each carrying the in-step hash, so it is that
   version), it equals the zip's file -- a source after the normalisation a
   system applies (BOM, CRLF, trailing blanks, trailing empty lines), an XML
   file as a canonical element tree (`canonicalXml`: attributes sorted,
   whitespace-only text dropped, entities and CDATA read, the declaration and
   comments ignored; a file that is not one well-formed tree is not equal);
   (c) an XML file, or a file the zip lacks: its in-step hash equals the
   snapshot's file of that name, so the deploy did not change it and nothing
   of ours is in it.
   A file the zip carries that the system does not show is a failed deploy of
   that file; a source the zip rewrites that still reads as the snapshot's
   was not applied (the tests would run against BEFORE). Anything else refuses
   the object: it is **not** recorded in `state.deployed`, the run fails
   naming the file, and the rollback leaves the object alone and prints the
   snapshot files (`files/<n>-<k>.bin = <name>`) to import it by hand.
   An object whose current hash equals its recorded deployed hash is
   re-imported from the snapshot's files; one that differs from both is
   reported and left alone. Then every object is hashed again and must equal
   its snapshot hash; only then does the run succeed and the snapshot go.
   The tool's repository row is deleted only if **this run created it**: the
   deploy (or a restore) reports `repo_new=<key>` when it calls `new_offline`,
   and that key is kept as `createdRepo` in `snapshot.json`, so `--rollback`
   from a saved state decides the same way. A row with the tool's name that
   was there at the snapshot (`repoAtSnapshot`; a fresh-mode `--keep` run
   leaves exactly that) is used for the import and left in place; a
   `snapshot.json` written before `createdRepo` existed deletes no row and
   says so. Objects that appeared since are listed as notes, not touched.
6. `--keep` leaves AFTER deployed and prints the `--rollback` command.

Content hashes close the stamp limits (one-second resolution, active rows
only). Limits: a restore does not delete a file the AFTER version added to an
object (the verification then fails, honestly); a run that dies between deploy
and the hash read leaves unknown deployed hashes, so `--rollback` refuses to
touch any object that differs. Every file of a deployed object is decided by
(a), (b) or (c) above, so no file rests on the in-step hash alone. What
remains: (c) adopts an XML file that equals the snapshot even when the zip
wanted a different one (abapGit may keep attributes the zip does not carry;
the tests then run against that metadata, which the class check shows); a
foreign write between `deserialize` and the serialise inside the one call
that restores exactly the zip's content, or exactly the snapshot's XML, cannot
be told from ours, and is harmless for the rollback (it re-imports what was
there). A system that rewrites XML beyond canonical equality (fields added or
dropped, values reformatted), or a source beyond the listed rules, makes the
run fail closed (never adopted) -- how abapGit's serialiser rewrites the XML
of a deserialised object is not yet measured on A4H.
That `serialize` in the same step sees what `deserialize` just activated is
read off the abapGit source, not yet measured on A4H; the post-deploy report
also lengthens the deploy's answer by one row per file, and a cut answer
fails the run (no end row, or a `result_text` that is not JSON) rather than
adopting anything. The abapGit calls the snippets assume
(`zcl_abapgit_objects=>serialize( is_item io_i18n_params )`,
`zcl_abapgit_i18n_params=>new`, `cl_abap_message_digest=>calculate_hash_for_raw`)
are measured only against the abapGit source, not yet on a system.
Tests: `test/prove-inplace.mjs` (fake system; each rule checked failing without it).

### Measured on A4H for `--in-place` (2026-10-01)

- `cl_abap_message_digest` SHA-256 over abapGit's serialized files works on the sandbox; snapshot and verification hashed 13 objects.
- An AFTER zip without `package.devc.xml` makes abapGit plan a **delete** (action 4) of the package's own DEVC entry. In place nothing is deleted: a delete action is declined (decision no) and reported as `keep=`, never approved.
- A deploy re-activates DDIC objects even when their content is unchanged, so after an in-place run on a package that a fresh run installed with `--keep`, that fresh run's receipt stamps are stale and its `--cleanup` refuses those objects as changed. The content hashes of the in-place snapshot are unaffected (13/13 equal after rollback). (The fresh-mode receipt now holds vsp's sha256, which a re-activation does not move, and its cleanup is vsp's conditional delete; not yet measured on A4H.)
- End to end: snapshot of 13 objects, one class changed in AFTER, 127 system tests passed, rollback re-imported that class, 13/13 hashes equal to the snapshot.

- Second run, after the adoption rules above (same day, a fresh package): the hash read inside the deploy's own call works. For every one of the 13 objects, the class and DDIC XML that abapGit wrote back was byte-equal to the snapshot's, so the XML was adopted under "unchanged since the snapshot" and no canonical comparison was needed. The changed class source matched the zip. The abapGit repository row that the earlier `--keep` run had left was used for the import, and the rollback left it in place ("not created by this run"). Rollback re-imported one class and 13/13 hashes were equal to the snapshot. The fresh receipt's `--cleanup` again refused the six re-activated objects, as described above.

### Measured on A4H: cleanup by content hash (2026-10-01, the snippet version)

The sequence was a fresh `--keep` run, then `--in-place` on the same package, then `--cleanup`. Before this change it needed manual deletion of six objects. Now it completes on its own. The cleanup reported one class and five DDIC objects (one data element, four tables) as "stamp moved … but the content equals the receipt's hash (re-activated, not edited)" and deleted them. The repository row and the package went with them, and the residue was zero. abapGit's serialisation of an unedited object was byte-stable between the receipt and the cleanup, so no XML needed the canonical comparison. A DDLS object has not been run through this yet. (That was the snippet's own content hash; the cleanup is now vsp's sha256 (#320) and the same sequence has to be measured again on a system.)
