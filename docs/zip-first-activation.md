# ZIP layers: first activation (#647)

Measured against the `d8fad990` tree with a synthetic abapGit ZIP (FULL,
`/src/`, a package header and a class), in a disposable runtime root.

## Two input discrepancies

1. **No-edit source-host check.** `node bin/osd.mjs up --layer <zip>` and a
   subsequent `node tools/osd-build.mjs` with the same `OSD_LAYERS` rebuilt
   instead of reusing. The hashable source inputs and file digests agreed; the framed
   `generators` input differed: interpreted `up` used `binary:<hash of node>`,
   while the standalone builder used `tools:<hash of generator closure>`.
   `OSD_SELF` describes dispatch, not embedded code. Source dispatch now uses
   the source closure; a single-executable host still uses the binary identity.
   (Without the same layer configuration, a standalone builder intentionally
   builds a different system; CLI layers are not implicitly persisted.)

2. **The activation failure.** A save arriving during startup prime reproduced
   `warm: compile inputs changed; retrying the current view`, followed by
   `the tree is not the live generation (... with the saves since put back)`.
   Mount had already installed `package.devc.xml`; it was not the late input.
   The first STORE WRITE copied the complete class from the extracted base to
   the sparse overlay. Newly hashed inputs were
   `local/overlays/<sha>/zcl_zip_start_target.clas.abap` and `.clas.xml` (and any
   class includes present). Reverting the edited source digest cannot remove
   that new input topology. The deterministic STORE regression also reproduces
   the refusal with `.clas.abap` and `.clas.testclasses.abap` saved before prime.

## Repair and evidence

Mount now establishes complete class/interface copies as well as package headers
before the startup build names its generation. Copies are independent, existing
edits are never overwritten, and other object types retain lazy whole-object
copying. This spends the copy cost at mount rather than changing hash inputs on
an eligible first save. The immutable extracted base remains unchanged.

No warm proof, frozen-input fence, or cold-verifier comparison was relaxed.
The STORE saved-before-prime regression fails with the old header-only mount
(the strict live-input proof refuses prime) and passes with the repair.

`test/osd-zip-start-warm.mjs` starts the real CLI on a fresh generation tree with
`OSD_WARM=1`, checks no-edit reuse before saving, edits while startup prime can
still be running, and asserts a first warm swap, unchanged serving PID, generation
header, successful cold verification, and an APC connection surviving throughout.
It uses application STORE IPC in the one-runtime topology and the ADT kernel's
host STORE path in the older topology. `test/store-warm-activate.mjs` tests direct
STORE WRITE/ACTIVATE before prime deterministically in both modes.

`test/osd-up-help.mjs` checks help from an empty non-checkout directory, including
invalid layer arguments/environment: exit 0, usage, no startup and no filesystem
writes. Help dispatch precedes layer validation and standalone-home creation.
