# sandbox -- the disk behind DATASET and the file dialogs

What: deny-by-default file roots (`OSD_DATASET_READ` / `OSD_DATASET_WRITE`, `OSD_DATASET_HOME`,
`OSD_DATASET_AUDIT`), the rules of `tools/osd-dataset.mjs`. go/abap keeps the DATASET statements and names
these types as `DatasetMode`, `DatasetHandle`, `DatasetHost`, `Sandbox`, `SandboxFromEnv`.

API: `FromEnv() *Sandbox`; `(*Sandbox).Open(name, mode) (Handle, message)` and `Delete(name)`, the `Host`
interface; `Browse*` for the file dialogs; `Close()`. `BeforeOpen` (per sandbox) is a test seam between the checks and the open.

Invariants: nothing is reachable outside a root; every open and unlink goes through an `os.Root` of the
root that holds the path, so a parent swapped for a symlink cannot take it outside; a refusal is a
message, never a panic; a write root is readable too. No import of go/abap. Builds for js/wasm, where
`nofollow_other.go` stands in for `O_NOFOLLOW`.

`PinRead` opens and classifies a startup target, retaining its checked `os.Root`,
file descriptor and identity. `InstallRead` transfers those handles without
resolving the pathname again. `BeforeGrantOpen` and `BeforeGrantInstall` exercise
startup races in tests. `ReadFiles` remains available for exact regular-file
reads configured directly by a host; failed pins warn on stderr.

An initial symlink grants its resolved target. A file grant permits the resolved
path and symlink aliases to it, and requires the opened descriptor to match the
retained identity; it grants no sibling, parent, write or browsable directory.
A different hard-link pathname gets no authority, even for the same inode;
a hard link restored at the granted pathname is the same object and is allowed.
Replacing the file with a different inode requires a fresh file grant; independent
directory roots stay additive and may allow that replacement. Directory
grants retain the checked directory root and permit reads below it. Trailing
separators normalize like other user path input; they never grant a file's parent.
Go's filepath normalization handles platform drives and UNC paths; file identity
checks still apply on platforms without O_NOFOLLOW. Exact path keys are the fast
path; other case spellings (including UNC server/share casing) must match the
pinned parent and opened file identities and an unambiguous directory entry.
Distinct case-variant hard-link names on case-sensitive filesystems are refused.
`BrowseEntry` can inspect a file grant through that checked open, so `GUI_UPLOAD`
can read it. `BrowsePath` and `BrowseRoots` still require directory authority.

Startup parameter VALUES resolve against cwd. DATASET names keep their original
base: explicit `Home`, else the first explicit write root, else the first explicit
read root, else cwd. Added parameter grants never set `Home` or change that base.

Supplying a list means the user vouches for every path in it, including absolute
and `../` entries and directories containing sensitive files. A list the report
itself wrote in an earlier run is still the user's choice to pass. The host parses
it once before constructing the report, from the descriptor retained by its file
grant. Self-listing does not recurse. ABAP defaults, event mutations and later
rewrites of list or JSON input cannot add grants. `-no-default-reads` turns off
parameter and list grants; writes still require explicit write roots.
