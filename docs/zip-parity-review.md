# ZIP parity review, round 1

## Safety

The source ZIP reader refuses traversal, absolute/drive/backslash paths,
symlinks and special entries, case-insensitive duplicate paths and file/directory
collisions before publishing extracted files. It verifies entry CRC and expanded
size and matches local and central name/method/flags. Limits: 128 MiB compressed,
512 MiB expanded total, 64 MiB per entry, 20,000 entries, and 1000:1 expansion
ratio above 1 MiB. Inflate output is bounded by the declared expanded size.
Encrypted, split and ZIP64 archives are unsupported. Regression checks mutate
ZIP metadata and assert refusal before publication.

## Writes and active source

STORE WRITE, the dev API's implicit STORE WRITE, ADT source PUT, and ADT collection
create use ObjectStore. ZIP objects are copied in full into their revision's
overlay; new objects in archive packages use overlay package headers. Activation
writes generated output and source snapshots under build, while edited source
stays in the overlay. The dev watcher publishes that same store view. Ordinary
objects outside ZIP layers retain their normal writable roots. No write handler
writes source into build/source-layers. Overlay mount/copy/write paths refuse
links that redirect to the base. ADT create uses the same strict overlay root
check as STORE WRITE, including a root redirected after indexing.

#638 active source uses generation snapshots. Relocation retains the proven
archive source until successful activation; failed activation retains it. Cold
and warm overlay tests assert active readback and unchanged extracted sources.
First overlay publication is warm for eligible existing class/interface content
edits, with no runtime recycle; new objects and unsupported edits remain cold.
A real APC session regression checks a successful post-publication request on
the already-open connection.

## Identity and claims

With configuration, toolchain, generators, other source inputs and overlay fixed,
identical ZIP bytes reuse the generation; changed bytes, including ZIP comments,
change it. Overlay source changes also change it. Revision bookkeeping uses
.txt files excluded from generation hashing; it cannot invalidate code merely
because doctor metadata changed. Tests cover identical bytes, comments and
source changes. This is conditional on other inputs staying fixed, not a claim
that a generation depends only on a ZIP.

SICF identity stays the complete abapGit filename stem, including padded spaces,
through store/import/deploy/export/input exclusions. Node labels and URL routing
remain separate. Bare names retain their existing URL-derived registry behavior;
existing ICF suites exercise them. SICF/SAPC/SAMC store support does not extend
the measured RIS type list. Daemon API types/order match PIA's reported A4H
measurement; local host limitations remain in abap-daemons.md.

Same-layer overlay warnings use the resolved root package, documented in
source-layers.md. No carry-over/rebase or overlay export command is claimed.
Tests use synthetic public fixtures. The external acceptance archive is read as
input only; neither it nor extracted PIA source is tracked. Operational acceptance
logs and temporary sources stay outside tracked paths.

## Verification status

Source-level ZIP safety, doctor discovery and ADT/dev write checks pass in both
OSD_ADT_ONE_RUNTIME modes. Full transpile, unit, warm/APC, external acceptance
and six-shard evidence must come from completed runs; queued or interrupted
commands are not passes. See the local round-1 report for actual run results.
