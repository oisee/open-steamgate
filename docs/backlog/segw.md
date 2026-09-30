
## The loop is closed: a SEGW project from one YAML is on a real system (2026-09-19)

The README has promised "transpile -> Open SQL -> OData -> Fiori, deploying
back through abapGit" since the first week. Four links worked. The fifth had
never been walked, and tonight it was: `ZOSD_002_DEMO` is an IWPR in package
`$ZOSD_002` on A4H, with its IWMO, its service registration
(`/IWBEP/I_MGW_SRH` -> `ZCL_ZOSD_002_DEMO_DPC_EXT`) and five classes that
activated -- `ZCL_ZOSD_002_DEMO_MPC` inheriting `/IWBEP/CL_MGW_PUSH_ABS_MODEL`,
the real SAP class. Verified by reading the system rather than by abapGit's
green.

**The route is a person with a zip, and that was Alice's call.** The machine
route is blocked and stays blocked: IWPR, IWSV and IWMO are not ADT object
types, so nothing but abapGit can put them there, and abapGit standalone does
not activate on this release (four `CLIENT SPECIFIED` statements, confirmed
with a nine-line probe). `npm run segw:zip` writes the repository; a human
imports it.

**Three defects stood between us and the system, and every one was found by
comparing what we write with what a system wrote.**

- **The object name widths.** IWSV is padded to 35 (key 39) and IWMO/IWVB to
  32 (key 36). Ours were 34 for both. abapGit: "This syntax cannot be used
  for an object name".
- **`NODE_UUID` was not valid base64.** The first 22 characters of a digest
  with `==` stapled on: 55 of 59 decoded with non-zero padding bits, against
  0 of 60 in a real export. This was the "Error during deserialization" that
  named no field -- a decoder refusing input it cannot describe.
- **No BOM.** Every real IWPR starts `EF BB BF`.

**Why none of this was caught here.** There is a test holding
`tools/segw-gen.mjs` and `zcl_stg_segw_gen` byte-identical, and it passed
throughout. **A test that two implementations agree is not a test that
either is right.** Both wrote 34; both omitted the BOM; both made the same
ids. The instrument answers "do they match" and is read as "are they right".

Worse, and this is the part to remember: **the tree already held the right
answer and it was edited to match the generator.** `test/segw.mjs` had
`zui5_code_search_mdl` at 36 and `zui5_code_search_srv` at 39, both correct,
plainly copied off a real export once. Tidying the fixtures "to one style"
destroyed the only oracle in the repository -- and it felt like housekeeping.
`test/segw-corpus.mjs` now asks the corpora instead: 44 real files, widths
39/36/36, no exceptions, and it skips out loud where the corpus is absent.

**Open, and measured rather than felt.** `SBD_NOI` (NodeOfInterest: project
and node uuid, nothing else) appears in **16 of 16** real IWPRs and in none
of ours; `SBD_AT` in 14 of 16. Neither blocked the import. Whether SEGW
renders the tree without them is the next thing to look at, and it is a
question for eyes, not for a query: rows in tables and a project are not the
same thing.

---

## 4. The road to a system

```
4.1  capture IN: DDIC + table contents from a system into our files   [V]
     └─ this is the thing we lack: our DDIC and seed rows are hand-made
     └─ external: rfc export (abapGit ZIP) + Data Config, both exist in vsp
4.2  deploy OUT, as a ladder                                          [V]
     ├─ rung 0  abapGit on the box pulls the repository itself   (nothing to build)
     ├─ rung 1  vsp deploys CLAS + DDIC; IWMO/IWSV registered by hand once
     ├─ rung 2  vsp triggers abapGit deserialize        (gated on 0.6)
     └─ rung 3  vsp learns IWSV/IWMO/IWPR natively      (only if install-free
                deploy becomes a promise)
4.3  two bundles, never conflated                                     [S+V]
     ├─ out: classes, DDIC, registration objects
     └─ in: DDIC + table contents; data/*.tabu.json does not go back
```

## 5. SEGW, the application (T's, with my editor on top)

```
5.1  the wizards SEGW has                                             [S]
     ├─ import from a DDIC structure
     ├─ map to a data source
     └─ referential constraints, complex types, data sources by hand
5.2  node order, drag and drop (STG_SEQ)                              [S]
5.3  a text row created when there is none                            [S]
5.4  Generate into src/ and a registration without a restart          [S+T]
5.5  the informational Cloud abaplint pass, numbers per release       [T]
```

## 7. stg-compile leftovers (S), blocked on an oracle

```
7.1  Include: a model that merges another service's model
7.2  a function import mapped to a function module
     └─ neither has a corpus example; both need a small sample project
        built on A4H (0.3 / 0.4 territory)
```
