
## 9. Upstream, outside this repository (T's, verbatim from them)

```
9.1  transpiler #1835, @abaplint/database-duckdb                      [T]
     └─ open since 2026-09-12, checks green, no review
     └─ external: Lars merges; PR only, never merge ourselves
     └─ blocks nothing here; the branch feat/database-duckdb lives until then

9.2  transpiler: 2.13.87 is out (2026-09-14)                          [T]
     └─ DONE as far as publishing goes: 2.13.87 carries #1836 (flat concat
        chain) and #1843, so both generators can drop the 200-line SADL
        rule (segw-gen's sadlXml and zcl_stg_segw_gen_dpc). T's files
     └─ it does NOT let us leave the linked local build, which is what it
        looked like it would do. Checked against the open pull requests:
        #1846 (a W3MI object keyed on its name, not its file name) and
        #1845 (a binary file survives the copy to output) are both merged
        (2026-09-18), and the whole media path rests on them. Without #1846 the
        registry is written abap.W3MI["zork-mini%2ez3"] while
        WWWDATA_IMPORT asks for "ZORK-MINI.Z3" and finds nothing; without
        #1845 the bytes beside the module are corrupt
     └─ so do NOT record the dependency by bumping package.json to
        ^2.13.87. ^2.13.86 already resolves there, and an npm install would
        replace the link and take the media down without saying so. The
        debt stays named instead: DEBT-2026-09-13-linked-transpiler

9.3  open-abap-core: BAPI_TRANSACTION_COMMIT / ROLLBACK over the LUW   [T]
     └─ written, eb0bedd on branch bapi-transaction in the fork, unpushed
     └─ waits on 9.2, then PR, then the commit_work test in open-abap-odata
     └─ external: Lars merges

9.4  open-abap-core: the APC family a real handler needs               [T]
     └─ core's if_apc_wsp_extension has two methods, a stateful handler
        needs five (on_accept, on_close, on_error) and if_apc_wsp_message
        needs set_text; cl_apc_wsp_ext_stateful_base does not exist
     └─ written and tested in open-abap-apc, not yet a PR
     └─ external: Lars merges; until then open-abap-apc ships its own copy
        and leaves core's src/tcp out of its dependency

9.5  oisee/vivid-vibes: what actually stops the full package       [A/T]
     └─ MEASURED 2026-09-14, and the old entry ("2 of 85 implement them,
        so 75 do not transpile") was wrong. Transpiling local/vivid-vibes
        as the only o4d input fails with 17 errors, and they are not what
        was assumed:
        ├─ ~13 of them are two dev-time report programs, not the demo:
        │  zo4d_render_demo.prog.abap and zo4d_offline_export.prog.abap,
        │  which call cl_gui_frontend_services (SAP GUI, absent in
        │  open-abap) and use X255. They are export tooling and have no
        │  business in a browser build
        ├─ implement_methods on exactly ONE class,
        │  zcl_o4d_mountains_oops_a (get_required_media, is_loopable) —
        │  that is the DEFAULT IGNORE family, abaplint #4291
        └─ two real errors in zcl_o4d_composer ("field frame does not
           exist in structure")
     └─ so the full 85-effect package is two programs and two classes away
        from building, not 75 classes away. The 31 effects absent from the
        current build are absent because nobody copied them into
        local/o4d-apc, not because they fail
     └─ what this makes cheap: excluding the two *.prog.abap files is a
        glob, and then vivid-vibes can BE the input instead of being
        curated into two folders by hand
     └─ DEMONSTRATED, not merely argued: with vivid-vibes as the only o4d
        input and four entries added to exclude_filter — the two .prog
        files, zcl_o4d_mountains_oops_a and zcl_o4d_composer — the tree
        transpiles clean, 1094 objects and **83 effect classes against the
        54 the demo ships today**. Config only; nothing in her repository
        had to change. Reverted afterwards, because what the demo contains
        is Alice's call and two effects are dropped by name to get there
     └─ so the recommendation is not a lean/extended branch split but one
        input and four excludes; local/o4d and local/o4d-apc then go, and
        the hand-kept duplicate goes with them
     └─ external: Alice's repository, a patch there is the fix — the two
        real errors in zcl_o4d_composer, and mountains_oops_a once
        abaplint #4291 lands or its two methods are written

9.5a open-abap-core: GENERAL_GET_RANDOM_INT                            [S]
     └─ found 2026-09-14 by replaying the MiniZork walkthrough through the
        bundle's APC channel: the Z-machine's `random` opcode calls it, it
        does not exist, and CX_SY_DYN_CALL_ILLEGAL_FUNC closes the channel
        on the first dice roll — the troll fight, twenty-five commands in
     └─ small and contributable; a fork, since we have no write access to
        open-abap-core. ANOMALY-2026-09-14-general-get-random-int
     └─ WRITTEN AND PROVEN 2026-09-14, not yet offered: twelve lines on
        core's own cl_abap_random_int, in .local/lars/open-abap-core. With
        it the whole walkthrough plays in the bundle, every assertion,
        start to finish. The test still tolerates the old death because a
        fresh clone of core has no such file
     └─ OPENED: open-abap-core#1221, 2026-09-14, after asking T for
        objections (none: "take it") as Alice instructed. Lint and the full
        core unit suite green on a clean clone of the fork, the four new
        tests confirmed to have run, and checked by negative control — the
        naive 1..RANGE version fails random_int_zero with "Expected '0',
        got '1'"
     └─ the contract was measured on A4H, not inferred, and the inference
        was wrong twice over: it is 0..range inclusive, and a negative
        range is legal. cl_abap_random_int cannot express either, because
        intinrange asserts high > low and low >= 0

9.5b zork-abap: the Z-machine assumes random( ) returns 1..range        [A]
     └─ falls out of the A4H measurement. The Z standard says the `random`
        opcode yields 1..range; GENERAL_GET_RANDOM_INT yields 0..range. So
        zcl_ork_00_zmachine:557 takes the module's answer unmapped and will
        occasionally store 0 where the story expects 1..range — on a real
        system as much as here
     └─ not ours to fix and not the module's job to bend: matching the real
        system is what #1221 is for, and the caller maps

9.6  Bun, measured rather than assumed                                [T]
     └─ done in part 2026-09-13: it runs, and twenty reads took 220 ms
        against Node's 264 ms (docs/bun-spike.md)
     └─ still open: the three request shapes (100/20, 1000/100,
        5000/100 rows) so the brief has Bun beside Node 2 ms and goja
        36 ms on the same axis
     └─ confirmed: Bun is JavaScriptCore, not V8
     └─ part two 2026-09-14: no native dependencies exist at all
        (database-sqlite is sql.js, wasm); the bundler is 166x faster and
        unusable; the compiled binary is not blocked by #1841

9.7  oisee/vivid-vibes: the megademo player asks for ?image=          [A]
     └─ found 2026-09-14 while making SMW0 media work in the bundle.
        get_megademo_html writes `img.src='?image='+n`; the handler's
        route is `?img=`, and the SMW0 objid carries the extension
        (ZO4D_05_COPPER.PNG). So the gallery images of the DEFAULT player
        have never loaded, on Node or in the browser, silently: the
        request falls through to the default branch and returns the page
     └─ CORRECTED 2026-09-14, having been written wrong the same day: the
        first fix went into local/vivid-vibes, which is NOT an input folder,
        so it changed nothing; the second went into local/o4d, which is, but
        after the last build. The bundle was reported fixed while both
        copies still shipped `?image=`. Now built and verified by content:
        two occurrences of `'?img='+n+'.PNG'`, none of `?image=`
     └─ the dev player, line 443, was always right, which is how it hid
     └─ T confirmed 2026-09-14 and corrected their own copy of the claim:
        they had repeated `?image=` out of her page as fact without ever
        requesting it
     └─ external: Alice's repository, a one-line patch there is the fix

9.8  local/vivid-vibes is a shadow copy, not a duplicate input        [A]
     └─ CORRECTED 2026-09-14: the first version of this entry said the
        directory walk picks a winner silently. It does not. Only local/o4d
        is in abap_transpile.json; local/vivid-vibes holds 121 objects, 85
        of which the build also has, and is not an input at all. So it is
        not a race that happens to go the right way — it is a folder that
        looks like source and absorbs edits that reach nothing
     └─ now reported rather than remembered: tools/osd-inputs.mjs runs as
        part of `transpile` and names both shapes, a later input overriding
        an earlier one and a folder beside the inputs that is not one.
        test/osd-inputs.mjs. It prints and never fails the build, because
        either can be deliberate
     └─ what is left for Alice: whether local/vivid-vibes should be the
        input (it is the complete package, 237 files against 60) or should
        go. Today the smaller copy is what runs
```

---

## External dependencies, all of them in one place

```
Lars / abaplint
  ├─ transpiler #1835 (DuckDB driver)          closed unmerged, see 9.1
  ├─ transpiler #1836 (flat concat chain)      merged 2026-09-13
  ├─ transpiler #1841 (%23 breaks Bun)         open, blocks 1.3
  │   └─ when it reaches npm, SADL_CHUNK can go from both generators
  ├─ open-abap-odata                            license still "todo"
  │   └─ we reimplement, contribute fixes, do not fork
  ├─ open-abap-adt                              license empty, interfaces only
  └─ open-abap-core                             T's APC PR, not written yet

SAP
  ├─ A4H sandbox            only on Alice's word, MCP is read-only
  ├─ abapGit on the box     the blessed last mile
  ├─ SAP-samples/abap-platform-refscen-flight   the RAP oracle, Apache-2.0
  └─ SAPUI5 1.120.50 from the CDN               the apps' runtime

Tooling
  ├─ bun 1.4.2              installed (~/.bun), runs everything
  ├─ Go 1.26                installed (used for the goja spike)
  └─ npm, pinned by the lock file

Known defects we live with
  ├─ no implicit MANDT in the transpiler        ANORMALIES, T0009 kept visible
  ├─ bun does not decode %23 in a specifier     transpiler #1841; blocks
  │     `bun <script>` only — NOT the compiled binary (measured 2026-09-14)
  ├─ bun's bundler emits import.meta + TLA        ANOMALY-2026-09-14; webpack
  │     stays for web:preview, the binary is unaffected
  └─ Bun runs JavaScriptCore, not V8            corrects the vision draft
```

## Two for abaplint/abaplint, both reproduced here

Verified independently on abaplint 2.120.50 with minimal projects, not
relayed: `.local/` scratch, no libraries, no demo. Both have a live
consumer in this repository, which is the part that makes them worth
raising rather than noting.

**Arithmetic against a character literal is inferred as a character
field.** Thirteen lines:

```abap
DATA lv_f TYPE f.
DATA(a) = lv_f * '0.25'.            " -> Character(4)   wrong
DATA(b) = lv_f + '0.25'.            " -> Character(4)   wrong
DATA(c) = lv_f * 2.                 " -> Float          right
DATA(d) = lv_f * CONV f( '0.25' ).  " -> Float          right
```

The literal's length becomes the field's. In ABAP the result of arithmetic
is never character-like; with an `f` operand the calculation type is `f`.
An integer literal does not poison it, a `CONV` does not either — only the
bare character literal. Consumer: `zcl_o4d_sales_dance` computes bar
heights this way, so they are truncated to about two significant digits.
It draws, it looks plausible, and nothing reports the loss.

**`implement_methods` does not honour `DEFAULT IGNORE` / `DEFAULT FAIL`.**
A class may legally omit such a method; the rule demands it anyway.

```abap
INTERFACE zif_t PUBLIC.
  METHODS required.
  METHODS optional DEFAULT IGNORE.
ENDINTERFACE.
```

A class implementing only `required` gets `Implement method "optional"`
[E]. The control matters: removing `DEFAULT IGNORE` produces the identical
message, so the rule is not reading the modifier at all, although the
parser understands it (`method_def`, v740sp08, marked as available in
OpenABAP). Consumer: a class that legitimately omits an optional method
cannot be transpiled, and the error says "implement this" where ABAP says
"you need not". Switching the rule off in the project does not help — the
transpiler runs its own mandatory set.

Raise as pull requests rather than issues where the fix is small, and note
what Lars said on transpiler#1836: a branch inside the repository triggers
the regression and performance suites and a fork's branch triggers neither.
Write access is the deciding factor; `oisee` had none on open-abap-core
(403) and #1218 went as a fork.
