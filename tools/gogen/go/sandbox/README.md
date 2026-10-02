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
