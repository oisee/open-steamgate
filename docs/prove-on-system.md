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

## It deletes only what it brought, unchanged

The run creates its own package and so owns it:

- The package must not exist when the run starts.
- No object of the zip may exist yet, in any package.
- The run deletes an object only if it is in the run's **receipt** and its
  version stamp is unchanged since the import, **or** its stamp moved and
  its content is still the one the receipt hashed (a re-activation is not
  an edit).
- It deletes only its own repository row: the one named `OSDPROVE <package>`
  whose key is the key its own import reported. This needs no receipt, and
  it also happens after a refused import, since the row is the run's own.
- It deletes the package (created by this run) only when nothing else is in it.

There is no abapGit `purge` and there is no `--reuse`. The zip's object
list alone never authorises a delete. **Objects** need the receipt. The run's
repository row and its empty package are recognised by identity: name and
key, and emptiness.

### The run receipt

Right after an import that was not refused, the run writes
`.local/prove-runs/<package>.json` (gitignored; `OSD_PROVE_RUNS` names
another folder). It holds:

- the package;
- the repository key and name;
- the zip's object list;
- for each object that the import wrote into the package, its TADIR
  identity, a version stamp read on the system right after the import, and
  the content hash described below.

The stamps are read by a small snippet (`receiptAbap`), and the cleanup
reads them again with the same ABAP:

| Kind | Stamp |
|---|---|
| CLAS, INTF | the newest REPOSRC `UDAT`+`UTIME` over abapGit's own include list (`zcl_abapgit_oo_factory=>get_by_type( )->get_includes( )`, the list abapGit's `changed_by` reads), plus how many of those includes exist |
| PROG | its REPOSRC `UDAT`+`UTIME` |
| TABL, DTEL, DOMA, TTYP | the active DD02L / DD04L / DD01L / DD40L row's `AS4DATE`+`AS4TIME` |
| DDLS | the active DDDDLSRC row's `AS4DATE`+`AS4TIME` (**to be measured on A4H**: abapGit's own DDLS object reads the source through `IF_DD_DDL_HANDLER~READ` with `get_state = 'A'` into `DDDDLSRCV`, whose `AS4USER`/`AS4DATE`/`AS4TIME` its `changed_by` uses; the table and field names are read off that source and off memory of the DDIC, not yet seen on a system) |

Any other kind gets no stamp. Such an object is not in the receipt, the run
reports it, and it is never deleted. DCLS (access controls) is one: abapGit
reads it through a handler into `ACM_S_DCLSRC` and the table behind that is not
known here, so it is not stamped and not deleted. Its content *can* be hashed
(abapGit serialises any object) and its files would be `.dcls.asdcls` and
`.dcls.xml`; giving it a stamp, or deleting a stamp-less object by hash alone,
is not done.

#### The content hash (fresh mode)

A moved stamp is not an edit. Measured on A4H twice: an `--in-place` run
(or any deploy) on a package that a fresh `--keep` run installed re-activates
DDIC objects, so their version stamps (REPOSRC `UDAT`/`UTIME`, DD
`AS4DATE`/`AS4TIME`) change while the content does not, and the fresh run's
`--cleanup` refused them as "changed since the import" and they had to be
removed by hand.

So the receipt also holds, per object, the SHA-256 of each file of its abapGit
serialisation (`files: [{name, sha256, size, cx?}]`, and `hash`, the SHA-256 of
the sorted `name=sha256` lines, the same `objectHash` as the in-place
snapshot). The hash is read **by the in-place mode's own snippet**
(`hashItemBlock` / `serializeBlock` in `tools/osd-prove-inplace.mjs`:
`zcl_abapgit_objects=>serialize`, `cl_abap_message_digest` SHA-256), shared and
not copied, and inside the receipt snippet, in the same dialog step as the
stamp. The cleanup snippet uses the same `serializeBlock` for its comparison, so
both sides hash the same bytes.

The rule, in the cleanup snippet (one step, so nothing changes between the
check and the delete):

- stamp unchanged: delete, as before (the hash plays no part);
- stamp moved (or unreadable) and the receipt has hashes for the object:
  abapGit serialises it now; if its files are exactly the receipt's (same
  names, same hashes), delete (`rehashed=` in the report, "re-activated, not
  edited" in the log); otherwise keep it, report `hashdiff=` and fail the
  run: "a foreign edit";
- stamp moved and no hash in the receipt (an old receipt, or an object abapGit
  could not serialise at receipt time): keep it as before. The cleanup says so
  in its log ("decided by the version stamp alone, as before").

A hash never *adds* a delete where the stamp did not: if the stamp is unchanged
the object goes, hash or not, so the same-second limit below is unchanged. A
serialisation that raises at cleanup time keeps the object (fail closed, and the
problem names it).

**XML, and what is sound.** abapGit rewrites XML on serialisation, so a hash of
raw bytes could in principle differ for a file nobody edited. Measured on A4H
(`--in-place`, run 3): all 13 XML files were byte-equal after a deploy, so the
byte hash alone is the rule that held. When the byte hash of an XML file still
differs, the cleanup does not treat that as an edit by default and does not
ignore it either. At receipt time each XML file is also read back by chunks (the
chunk carries the file's hash, so it is that version) and the SHA-256 of its
**canonical element tree** (`canonicalXml`, the in-place mode's: attributes
sorted, whitespace-only text dropped, entities and CDATA read, declaration and
comments ignored; a file that is not one well-formed tree has none) is stored as
`cx`. At cleanup, an object whose stamp moved and whose hash differs is
accepted only if **every differing file is XML, the set of file names is the
same, each such file has a `cx`, and its canonical tree now equals it**. Then the
tool runs the cleanup snippet a second time with that object's *current*
file hashes as the expected ones, so the snippet checks again, in its own step,
that the object is still exactly what was read; the second call replaces the
first. Why this is sound: a canonical tree keeps every element name, attribute
and non-blank text, so an edit of a value or a structure changes it; what it
ignores (indentation, attribute order, line endings, declaration, comments)
carries no content abapGit would deserialise. Why it is limited to XML: a
source file differing in bytes is an edit, by the same measurement that found
XML equal. A receipt whose XML has no `cx` (the read-back failed) decides by
bytes only. The cost is one chunk read per XML file at receipt time.

**Limit of the stamp.** The stamps have one-second resolution, the system's
own change stamps. A change made in the *same second* as the stamp it
replaces is not seen. Any later edit of a class include moves that
include's `UDAT`+`UTIME` past the recorded maximum and is seen. The
package is created by the run, and without `--keep` it exists only for the
run. Such an edit would have to come from someone writing into it in that
second.

A second limit: the stamps read *active* rows only (REPOSRC `r3state = 'A'`,
DDIC `as4local = 'A'`). An edit saved but not activated while `--keep`
leaves the package in place does not move the stamp, and a later
`--cleanup` deletes the object together with that inactive version. Only
the run's own objects in its own temporary `$` package are affected, and
only on an explicit `--cleanup`.

The content hash above covers an object whose stamp moved. It does not close
the same-second case (a stamp that did not move deletes as before) nor the
saved-but-inactive case. Reading the hash for every object, whatever its stamp,
would close both, at the cost of refusing what a stamp lets through today; not
done here.

A refused import writes no receipt, and neither does an import whose stamps
could not be read. In both cases the cleanup deletes no object.

A complete cleanup removes the receipt. An incomplete one keeps it, so that
`--cleanup` can try again.

## The steps

Every step is a separate, small MCP call, because vsp can cut a long call
with "context canceled".

1. **Zip.** The tool lays the folder out the same way as
   `tools/osd-abapgit-zip.mjs`: only objects that the deploy unit lists,
   and the build fails closed on anything else.
   - The zip is written in process (`zipInProcess` in
     `tools/osd-abapgit-zip.mjs`: deflate, sorted paths, fixed timestamp),
     not by the `zip` binary, so the tool spawns no child.
   - A unit that puts no class in the zip fails here, because there is
     nothing to prove.
2. **Preflight.** This step reads only and changes nothing. The run is
   refused (exit 2) in two cases:
   - **The package exists.** The run is refused whether the package is
     empty or not, and whether or not a repository is registered for it.
     The message says how to inspect it (SE80 or ADT, abapGit's
     repository list) and to remove it by hand or pick another
     `--package`.
   - **An object of the zip already exists in TADIR, in any package.** An
     import would take it over. The refusal names each object and its
     package.
3. **Package.** The tool runs `create DEVC $X`.
4. **Import.** An `execute_abap` snippet decodes the zip. The zip is
   embedded as base64 in lines of 200 characters. The snippet then:
   1. calls `zcl_abapgit_zip=>load( )`;
   2. creates the offline repository `OSDPROVE <package>` with
      `new_offline( )`;
   3. runs `set_files_remote( )`, `deserialize_checks( )` and
      `deserialize( )`. Only new objects (action add) and the
      run's own package entry are approved; any other overwrite refuses
      the import (see the measured section below). The warning_package
      decisions are **no**: abapGit then leaves out any object that would
      move in from another package.

   If a repository under any other name is found at this point, the
   snippet does not import into it. The report carries the repository key,
   and a report without a key fails. It also carries the status, the
   abapGit log messages of types E/W/A, and the TADIR count.
   - Status S passes.
   - Status W passes only when its W messages came back and are shown,
     because abapGit's W is a warning about an object it still
     deserialised. W with no message fails.
   - E, A, no status, an unknown status, any E or A message, and messages
     that were not carried back all fail.
5. **Classes.** For each class, the tool reads
   `SEOCLASSDF-WITH_UNIT_TESTS` and the line count of the CCAU include
   (`cl_oo_classname_service=>get_ccau_name`, `READ REPORT`). Every class
   of the zip must have an entry.
6. **ABAP Unit.** For each class, the tool runs `test CLAS X` with
   `include_dangerous`.
   - **The result must be readable.** It must be JSON and must name a test
     class of that class. Anything else fails.
   - **Methods are compared by identity, not by count.** The set of
     `TESTCLASS->METHOD` names the system ran (case-insensitive) must equal
     the set of `FOR TESTING` methods in the source. With `--osg run`, it
     must equal the set that OSG ran. The run names what is missing on
     either side.
   - **Unnamed method entries.** An entry without a name does not count.
     If such an entry carries an alert, it fails the run as "an unnamed
     test method failed".
   - **A class with no tests on either side is not called.** That means no
     tests on OSG and, by step 5, none on the system (WITH_UNIT_TESTS not
     set, empty CCAU). Its row says so.
   - **Something must run.** If no test method ran on the system at all,
     the run fails because there is nothing to prove.
   - **Known limit: inherited test methods.** The source parse credits a
     test method inherited from an abstract local test class to the class
     that declares it, while ADT names the subclass. Such a class shows as
     a difference, not as a pass.
7. **Cleanup.** This is one snippet, so nothing changes between the checks
   and the deletes. It works in this order:
   1. **Repository check.** If the package has a repository, it must be the
      tool's own by name and the one this run imported into, by the key
      from step 4. Otherwise nothing at all is deleted. If the import
      reported no key, any repository refuses the cleanup.
   2. **The receipt's objects.** For each object in the receipt, the
      snippet reads its TADIR row. It keeps the object only if `DEVCLASS` is
      this package **and** the stamp it reads now equals the receipt's
      stamp, **or** its stamp moved and the files abapGit serialises now are
      the receipt's hashed files (see the content hash above).
      - A changed object is kept and reported, and the run fails (exit 1).
      - An object that is missing or in another package is reported and
        not touched.
      - It hands exactly the objects it kept to `zcl_abapgit_objects=>delete`,
        abapGit's object layer, which deletes them one by one in dependency
        order and commits each.
      - Nothing outside the receipt is ever handed to it. With no receipt,
        no object is deleted.
   3. **The repository row.** It is deleted with
      `zcl_abapgit_repo_srv->delete`. In abapGit's source, that method
      removes the persisted repository and checksums and drops the
      favourite flag; it deletes no object. (`purge` is the method that
      deletes objects, and the tool does not call it.)
   4. **The package.** It is deleted through abapGit's DEVC object, which
      deletes only an empty package, and only if TADIR holds nothing else
      under it and TDEVC has no subpackage with `PARENTCL` = the package.
      Otherwise the package is kept, what is there is listed, and the run
      fails (exit 1). Subpackages are never deleted.

   `--keep` skips this step and prints the `--cleanup` command. That
   command needs the receipt. Without one it refuses (exit 2) before it
   connects to anything, and it says how to inspect the package by hand.
   With a receipt, it does the same work with the receipt's objects,
   stamps and repository key, and it removes the receipt when the cleanup
   is complete.

`execute_abap` returns no output that the caller can read. Each snippet
therefore ends with `cl_abap_unit_assert=>fail( msg = ... )`, and the result
arrives as the alert title. The message is framed by `OSDPROVE<<` and
`>>OSDPROVE`, so the tool can find it in vsp's text. A message without its
end marker may have been cut, so it fails the run. vsp's "no output
captured" message is normal. All snippets are ASCII.

The result is a table:

```
class              | methods on OSG | methods on system | failing on system
```

The tool exits with 1 if any of these happens:

- an import error;
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
models what vsp returned on A4H.

- **The fake reads the real zip.** It reads the zip that the tool builds
  from `test/fixtures/prove-on-system/`, so the WITH_UNIT_TESTS case comes
  from the class XML and is not a canned answer.
- **The fake models the system state.** It keeps packages with their
  parents, TADIR rows, and abapGit repositories. Its cleanup does what the
  snippet asks of abapGit and nothing more, so a test can see what
  survives.
- **Some properties are checked as text.** The fake does not execute ABAP.
  So the snippet's own properties (the `DEVCLASS` check, the subpackage
  query, the empty-package condition, `warning_package` = no, no `purge`,
  the stamp comparison)
  are checked on the snippet's text.

The tests cover:

- **Basic runs:**
  - the happy path;
  - a deserialize error and its message;
  - a class without CCAU;
  - a failing test method;
  - an object abapGit could not delete;
  - `--keep` followed by `--cleanup`, which cleans completely by the
    receipt and removes it;
  - the refusal of a package that does not start with `$`.
- **Preflight refusals:**
  - an existing package (empty, with a foreign object, with a repository);
  - a zip object that already exists in another package.
- **Cleanup scope:**
  - a foreign object and a subpackage that survive the cleanup and are
    reported;
  - a cleanup that deletes only the zip's items when the package holds
    more;
  - a zip item found in another package.
- **The receipt's content hashes** (`describe("the receipt's content hashes")`):
  - the receipt carries each object's per-file hash and a canonical digest for
    XML, taken in the receipt snippet's own step with the in-place
    serialisation;
  - stamp moved and hash equal: deleted;
  - stamp moved and hash differs: kept, the receipt stays, and a later
    `--cleanup` keeps it too;
  - stamp unchanged and hash differs: deleted as before;
  - an old receipt (no hashes), or an object that could not be hashed:
    as before, and the log says so;
  - XML that abapGit rewrote (same tree, other bytes): deleted through the
    second cleanup call, which carries the current hashes; a changed XML
    value, a malformed XML, a source file that differs beside an XML that only
    moved, a receipt without `cx`: kept;
  - DDLS: its file names and stamp snippet, a view that is stamped, hashed and
    deleted, a changed `.asddls` kept (fixture built in a temp folder);
  - in `test/prove-inplace.mjs` the whole sequence: a fresh `--keep` run, an
    in-place run on its package (the fake re-activates every object a deploy
    writes), then `--cleanup`: deleted by hash; the same with the hashes
    stripped from the receipt: refused as measured; one object edited after:
    kept, the other deleted.
  The fake does not execute ABAP: what the cleanup snippet *decides* (compare
  the sets, delete only on equal) is modelled in the fake and pinned on the
  snippet's text; the real behaviour is for A4H to measure.
- **The receipt:**
  - a refused import writes no receipt, and `--cleanup` then refuses and
    deletes nothing;
  - `--cleanup` without a receipt refuses before any connection is made,
    even with a zip list at hand;
  - an object changed after the import (its stamp differs) survives both
    the automatic cleanup and a later `--cleanup`;
  - a complete automatic cleanup removes the receipt.
- **Repository ownership:**
  - a foreign repository that appears after the preflight;
  - a repository key that changed;
  - a renamed repository;
  - an import report without a key.
- **Missing evidence:**
  - no status;
  - W with and without its messages;
  - E without a message;
  - an unknown status;
  - no end marker;
  - no class-check entry;
  - unit output that is not JSON or does not name the class;
  - nameless entries, with and without an alert;
  - the same count with different names;
  - `--osg run` against the methods OSG ran;
  - no class in the zip;
  - no test method run.
- **The wording of the verdict** in both modes.

No child process is spawned: the fake reads the in-process zip in process,
and the suite passes with `child_process` disabled. Each case was checked to
fail when the code it covers is removed.

## Measured on the sandbox: what abapGit's overwrite list holds

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
3. **Deploy.** Through the tool's own offline repository. An overwrite is
   approved only for an item of the AFTER list with action update or overwrite;
   any other entry, any data loss, any other repository refuses the import.
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

Content hashes close the stamp limits above (one-second resolution, active rows
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
also lengthens the deploy's answer by one entry per file, and a cut answer
fails the run (no end marker) rather than adopting anything. The abapGit calls the snippets assume
(`zcl_abapgit_objects=>serialize( is_item io_i18n_params )`,
`zcl_abapgit_i18n_params=>new`, `cl_abap_message_digest=>calculate_hash_for_raw`)
are measured only against the abapGit source, not yet on a system.
Tests: `test/prove-inplace.mjs` (fake system; each rule checked failing without it).

### Measured on A4H for `--in-place` (2026-10-01)

- `cl_abap_message_digest` SHA-256 over abapGit's serialized files works on the sandbox; snapshot and verification hashed 13 objects.
- An AFTER zip without `package.devc.xml` makes abapGit plan a **delete** (action 4) of the package's own DEVC entry. In place nothing is deleted: a delete action is declined (decision no) and reported as `keep=`, never approved.
- A deploy re-activates DDIC objects even when their content is unchanged, so after an in-place run on a package that a fresh run installed with `--keep`, that fresh run's receipt stamps are stale and its `--cleanup` refuses those objects as changed. The content hashes of the in-place snapshot are unaffected (13/13 equal after rollback). (The fresh-mode receipt now also holds content hashes, and its cleanup deletes a stamp-moved object whose hash equals the receipt's; not yet measured on A4H.)
- End to end: snapshot of 13 objects, one class changed in AFTER, 127 system tests passed, rollback re-imported that class, 13/13 hashes equal to the snapshot.

- Second run, after the adoption rules above (same day, a fresh package): the hash read inside the deploy's own call works. For every one of the 13 objects, the class and DDIC XML that abapGit wrote back was byte-equal to the snapshot's, so the XML was adopted under "unchanged since the snapshot" and no canonical comparison was needed. The changed class source matched the zip. The abapGit repository row that the earlier `--keep` run had left was used for the import, and the rollback left it in place ("not created by this run"). Rollback re-imported one class and 13/13 hashes were equal to the snapshot. The fresh receipt's `--cleanup` again refused the six re-activated objects, as described above.

### Measured on A4H: cleanup by content hash (2026-10-01)

The sequence was a fresh `--keep` run, then `--in-place` on the same package, then `--cleanup`. Before this change it needed manual deletion of six objects. Now it completes on its own. The cleanup reported one class and five DDIC objects (one data element, four tables) as "stamp moved … but the content equals the receipt's hash (re-activated, not edited)" and deleted them. The repository row and the package went with them, and the residue was zero. abapGit's serialisation of an unedited object was byte-stable between the receipt and the cleanup, so no XML needed the canonical comparison. A DDLS object has not been run through this yet.
