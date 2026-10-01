# Prove on a system: the same ABAP Unit on OSG and on a sandbox

`tools/osd-prove-on-system.mjs` takes a folder of abapGit-named objects,
puts it on a sandbox system through abapGit, runs each class's ABAP Unit
there, compares the counts with OSG, and removes everything again.

```
node tools/osd-prove-on-system.mjs <folder> --unit <deploy unit> [--manifest m.json]
     [--package $ZOSG_TMP_X] [--keep] [--reuse] [--osg count|run] [--server <mcp server>]
node tools/osd-prove-on-system.mjs <folder> --unit <deploy unit> --cleanup --package $ZOSG_TMP_X
```

**Use it on a sandbox only, and never on a productive or customer system.**
The tool imports, runs and purges. It accepts only a local package (a name
that starts with `$`) and refuses any other name before it sends anything.
It reaches the system through the vsp MCP server that `OSD_MCP_CONFIG`
names (default: `.mcp.json` at the repository root, which is gitignored).
Use `--server`/`OSD_MCP_SERVER` when that file configures more than one
server. No host, user or client name is written in the tool.

## The steps

Every step is a separate, small MCP call, because vsp can cut a long call
with "context canceled".

1. **Zip.** Lay the folder out the same way as `tools/osd-abapgit-zip.mjs`:
   only objects that the deploy unit lists, and the build fails closed on
   anything else. The zip is written in process (`zipInProcess` in
   `tools/osd-abapgit-zip.mjs`: deflate, sorted paths, fixed timestamp), not
   by the `zip` binary, so the tool spawns no child. A unit that puts no
   class in the zip fails here: there is nothing to prove.
2. **Preflight.** Before anything is written, the tool reads what the
   package holds: the abapGit repository registered for it, its TDEVC row
   and its TADIR objects. Step 7 purges the package, so without `--reuse`
   the package must not exist yet. A registered repository, an existing
   package or any object in it refuses the run (exit 2), and the refusal
   names the objects. `--reuse` admits a package whose objects are none or
   exactly the zip's objects, which is what an earlier run of the same zip
   leaves; any difference is refused and listed.
3. **Package.** Run `create DEVC $X`, unless `--reuse` found it.
4. **Import.** An `execute_abap` snippet decodes the zip. The zip is
   embedded as base64 in lines of 200 characters. The snippet calls
   `zcl_abapgit_zip=>load( )`, then reuses the package's repository or
   creates `new_offline( )`. It then runs `set_files_remote( )` and
   `deserialize_checks( )`, with every decision set to yes, and then
   `deserialize( )`. The tool reports the status, the abapGit log messages
   of types E/W/A, and the TADIR count. Status S passes. Status W passes
   only when its W messages came back and are shown, because abapGit's W
   is a warning about an object it still deserialised; W with no message
   fails. E, A, no status, an unknown status, any E or A message, or
   messages not carried back all fail.
5. **Classes.** For each class, the tool reads
   `SEOCLASSDF-WITH_UNIT_TESTS` and the line count of the CCAU include
   (`cl_oo_classname_service=>get_ccau_name`, `READ REPORT`).
   Every class of the zip must have an entry.
6. **ABAP Unit.** For each class, the tool runs
   `test CLAS X` with `include_dangerous`. The JSON result has
   `classes[].testMethods[]`, and a failing method has `alerts[]` with a
   title. The result must be JSON and must name a test class of that
   class; anything else fails. The one exception is a class that has no
   tests on OSG and, by step 5, none on the system (WITH_UNIT_TESTS not
   set, empty CCAU): it is not called and is marked so. If no test method
   ran on the system at all, the run fails: there is nothing to prove.
7. **Cleanup.** The tool reads the package again and purges only if every
   object in it is one of the zip's objects; otherwise it refuses the purge
   and lists what is there. It then runs abapGit `purge( )` with `delete_checks( )`. If
   the repository row is still there, the tool deletes it and runs
   `COMMIT WORK`. It then checks that no repository row, no TADIR object
   and no TDEVC package is left. Anything left fails the run. `--keep`
   skips this step and prints the `--cleanup` command that does it later.

`execute_abap` returns no output that the caller can read. Each snippet
therefore ends with `cl_abap_unit_assert=>fail( msg = ... )`, and the result
arrives as the alert title. The message is framed by `OSDPROVE<<` and
`>>OSDPROVE`, so the tool can find it in vsp's text. A message without its
end marker may be cut and fails the run. vsp's "no output captured"
message is normal. All snippets are ASCII.

The result is a table:

```
class              | methods on OSG | methods on system | failing on system
```

The tool exits with 1 in any of these cases: an import error, missing or
unreadable evidence, a count mismatch, a failing method, a refused purge,
or an incomplete cleanup. It exits with 2 on a refusal before anything was
written.

The last line says what was established and no more:

- in the default count mode: `system: N tests pass; OSG: N test methods
  counted from source, not run`;
- with `--osg run`: `proved: the same N tests pass on OSG and on the
  system`;
- on any failure: `NOT proved: k problem(s)`.

## The OSG side

By default (`--osg count`), the tool counts the `FOR TESTING` methods of each
class from abaplint's parse of the folder (helper methods are not counted).
It does not run them. With `--osg run`, it runs the class through
`tools/osd-unit.mjs` on this runtime. That needs the folder in the build
(`abap_transpile.json`), and any method that fails on OSG also fails the run.
The output states which of the two modes was used.

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
  count comparison catches this case (for example, 2 methods on OSG and 0 on
  the system), and step 4 gives the reason: WITH_UNIT_TESTS is not set and
  there is no CCAU include.

## Tests

`test/prove-on-system.mjs` runs the tool against a fake transport that models
what vsp returned on A4H. The fake reads the zip that the tool really builds
(from `test/fixtures/prove-on-system/`), so the WITH_UNIT_TESTS case comes
from the class XML and is not a canned answer. The tests cover:

- the happy path;
- a deserialize error and its message;
- a class without CCAU;
- a failing test method;
- an incomplete cleanup;
- `--keep`;
- the refusal of a package that does not start with `$`;
- a package that already holds objects, has a repository or exists;
- `--reuse` with exactly the zip's objects, and with different ones;
- an object that arrived during the run, which refuses the purge;
- each piece of missing evidence: no status, W with and without its
  messages, E without a message, an unknown status, no end marker, no
  class-check entry, unit output that is not JSON or does not name the
  class, no class in the zip, no test method run;
- the wording of the verdict in both modes.

No child process is spawned: the fake reads the in-process zip in
process, and the suite passes with `child_process` disabled. Each case was
checked to fail when the code it covers is removed.
