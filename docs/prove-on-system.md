# Prove on a system: the same ABAP Unit on OSG and on a sandbox

`tools/osd-prove-on-system.mjs` takes a folder of abapGit-named objects and
puts it on a sandbox system through abapGit. It runs each class's ABAP Unit
there, compares the test methods with OSG, and then deletes exactly what it
brought.

```
node tools/osd-prove-on-system.mjs <folder> --unit <deploy unit> [--manifest m.json]
     [--package $ZOSG_TMP_X] [--keep] [--osg count|run] [--server <mcp server>]
node tools/osd-prove-on-system.mjs <folder> --unit <deploy unit> --cleanup --package $ZOSG_TMP_X
```

**Use it on a sandbox only, and never on a productive or customer system.**
The tool imports, runs and deletes. It accepts only a local package (a name
that starts with `$`) and refuses any other name before it sends anything.
It reaches the system through the vsp MCP server that `OSD_MCP_CONFIG`
names (default: `.mcp.json` at the repository root, which is gitignored).
Use `--server`/`OSD_MCP_SERVER` when that file configures more than one
server. No host, user or client name is written in the tool.

## It deletes only what it brought

The run creates its own package and so owns it:

- The package must not exist when the run starts.
- No object of the zip may exist yet, in any package.
- The run deletes only the zip's own objects, and only those it finds in
  that package.
- It deletes only its own repository row.
- It deletes the package only when nothing else is in it.

There is no abapGit `purge` and there is no `--reuse`.

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
      `deserialize( )`. The overwrite decisions are yes. The
      warning_package decisions are **no**: abapGit then leaves out any
      object that would move in from another package.

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
   2. **The zip's objects.** For each object in the zip's list, the
      snippet reads its TADIR row and keeps it only if `DEVCLASS` is this
      package. It hands exactly those rows to `zcl_abapgit_objects=>delete`,
      abapGit's object layer, which deletes them one by one in dependency
      order and commits each. An object of the zip that is missing or in
      another package is reported and not touched. Nothing outside the
      zip's list is ever handed to it.
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
   command does the same work with the zip's object list. It has no
   import, so there the repository's name is the evidence of ownership.

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
  query, the empty-package condition, `warning_package` = no, no `purge`)
  are checked on the snippet's text.

The tests cover:

- **Basic runs:**
  - the happy path;
  - a deserialize error and its message;
  - a class without CCAU;
  - a failing test method;
  - an object abapGit could not delete;
  - `--keep` followed by `--cleanup`;
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
