
## 8. Housekeeping (S)

CI ABAP Unit pooling: consider reusing the Test Explorer's RISK LEVEL scheduler
only after proving isolated child databases and preserving the check that every
test class in the tree ran. The last green CI run on 2026-09-28 spent 14 s in
ABAP Unit versus 11 min 54 s in integration suites, so this is a lower-priority
speed task than splitting the costly integration cases (`docs/ci-tests.md`).

```
8.1  e2e data isolation, so the suite can run in parallel again
     └─ today: workers: 1, deterministic, 44 seconds
8.2  the flaky value-help spec, seen once, not reproduced
8.3  keep the preview build green (it broke twice on bundling)
8.4  verification discipline, after three false greens in one day     [S]
     └─ 2026-09-14, all three the same shape: a test that passed while
        the path it claimed to cover was broken (it called install()
        itself), a suite that passed against a stale build/sw.js, and a
        fix "verified" by grepping for a comment webpack strips
     └─ rules that follow: assert on CODE in a built artefact, never on
        a comment; a test must exercise the injected path, not simulate
        it; and a deployed bundle is verified by content, not by the
        deploy command exiting 0
     └─ DONE, the mechanism rather than the rule: the bundle carries a
        digest of itself, serves it at <mount>__preview/build, and the
        first test of the preview suite compares it with build/build.json.
        A registration that outlived a rebuild now says so instead of
        answering quietly. scripts/build-preview.mjs writes the stamp
     └─ a FOURTH one the same day, after the rule was written: a fix
        reported as shipped that had gone into a folder which is not an
        input (9.7, 9.8). The stamp would not have caught that one; the
        input report does
     └─ a FIFTH, 2026-09-19, and it says what the rule was still missing:
        **the rule names how to verify an artefact and nowhere names what
        the artefacts are.** The editor wave went out with abaplint, ABAP
        Unit and 943 wire tests green, and took the public preview down
        for three commits -- none of those four suites builds webpack, and
        the preview build was simply never run. The defect under it was
        that `await import()` does **not** keep a module out of a bundle:
        the store was imported lazily *so that* abaplint would stay out of
        the service worker, webpack followed the dynamic import as readily
        as a static one, and the one-chunk limit inlined it. A comment
        stating the intention sat right above it, which is the pair this
        file already names -- a comment describing behaviour is
        indistinguishable from one describing intent, and the second is
        commoner
     └─ so the list, since the rule needs one: touching `test/setup.mjs`,
        `web/`, `webpack.config.cjs` or anything they import means
        `npm run web:preview` **locally before the push**, and reading the
        bundle rather than the exit code. The IgnorePlugin entry is the
        fix, next to the AMDP one and for the same reason
     └─ still open: this is the argument for one e2e suite running against
        every packaging target, or the binary becomes a second runtime
        with no second check
8.7  a leak detector on the way out, not a rule in a document   [СДЕЛАНО]
     └─ 2026-09-14: a wire capture was about to go into open-rfc-go, a
        public repository, as a test fixture. It contained two LAN
        addresses, a host name, an Eclipse project name, a machine id and
        Alice's surname. I caught it by reading the bytes before committing,
        which is exactly the kind of catch that works until the once it
        does not
     └─ CLAUDE.md has said "no live identifiers in any tracked file" since
        the first week. The rule did not stop it; noticing did. That is the
        day's theme in a new place, and the answer is the same: a mechanism
        that cannot be walked past
     └─ what it should be: a check on `git commit` and again before a
        publish — addresses in the private ranges, host names of the
        machines in play, the user names, anything matching a GUID shape,
        and a *.jsonl or *.pcap staged at all. Hex-encoded too, since a
        capture hides its identifiers inside hex strings where grep for
        "192.168" finds nothing
     └─ scope: this repository and the sibling Go ones, since they take the
        same captures. A pre-commit hook is not enough on its own — hooks
        are per-clone and silently absent on a fresh one — so the same check
        belongs in CI where it cannot be skipped
     └─ Alice's call, 2026-09-14, and the right one
     └─ built 2026-09-14, `tools/osd-leak-scan.mjs`, `npm run leak`, hook in
        `.githooks/pre-commit`, CI in `.github/workflows/leak-scan.yml`
     └─ and it caught one the same hour, in the repository it was written
        for. A 746-byte logon template committed to open-rfc-go carried the
        captured system's host name, instance, address, logon string and
        user, all in UTF-16LE — and a hand scan run over that very file had
        reported it clean an hour earlier, because it looked for runs of
        printable ASCII and a NUL after every character is enough to hide a
        host name from a grep. The design lesson is one line: decode first,
        match second, over every encoding a file plausibly has
     └─ a sixth identifier was not text at all. The last six bytes of a
        session GUID are the client's own IPv4 packed into the uuid node
        field, which is how a LAN address travels through a public
        repository without ever spelling itself out. Matched in binary now,
        and only on two-byte prefixes: 10.x is one byte, any random blob
        produces one per 256, and the first run turned up seven of those and
        nothing real. A check that cries wolf is read once
     └─ its first real catch was the comment I wrote explaining the scrub. I
        cleaned the data and spelled both identifiers out in the prose beside
        it. Nothing was pushed, so nothing was public
     └─ what it finds on open-rfc-go's public main is Alice's to decide: two
        of her LAN addresses, her surname, and the stock A4H appliance host
        name, in files that predate this branch

8.6  source maps, so a failure names her ABAP line not our .mjs      [S] DONE
     ├─ done 2026-09-16 — and most of it already was: the transpiler writes
     │  a map beside every module (write_source_map), and osd-where.mjs
     │  resolves a generated position to the ABAP statement; the unit
     │  runner has named ABAP lines in its alerts for a while
     ├─ what was missing was the runtime: a request that died in ABAP was
     │  logged as a JavaScript stack. The child keeps short dumps now —
     │  what, where in ABAP, the frames under it — says the ABAP statement
     │  in its log, puts the position into the OData error's innererror,
     │  and answers them at GET /osd/dumps; ICF services report through
     │  the same door
     └─ the ADT runtime/dumps route reading them in ST22 shape is 2.6,
        ADT work, later
     └─ from T, 2026-09-14, half done already: `write_source_map` is
        ALREADY true in our abap_transpile.json and output/ carries the
        .mjs.map files, so only the consumer side is missing. 341 maps
        on this tree, resolving to the statement rather than the object:
        zcl_o4d_sales_dance.clas.mjs:1346 -> .clas.abap:119, which is the
        line the demo actually died on
     └─ the consumer is here: tools/osd-apc.mjs `describe(error)` already
        names the exception class and the frames from output/. With maps on
        and findSourceMap over the thrown object's stack it can name the
        ABAP statement instead. Costs a flag and some disk

8.5  the preview suite flakes on a worker-served page        [S] FIXED
     └─ seen on 2026-09-14, a different test each run, mostly a page.goto
        timing out or "execution context was destroyed". Diagnosed rather
        than retried, and it was a real race: web/index.html is the
        installer and does location.replace("app/") the moment the worker
        is ready, so every test that waits for the controller on that page
        and then goes somewhere collides with a navigation already in
        flight. The error surfaces on an unrelated line, which is why it
        read as noise
     └─ the fix is in the page, not the tests: index.html?stay leaves the
        visitor where they are instead of redirecting, which is a
        reasonable thing to offer anyway, and the suite uses it. Four
        consecutive clean runs, 6/6
     └─ the lesson is 8.4's: a suite that goes green on a second run
        teaches everyone to run it twice, which is how a real failure gets
        waved through. This one was hiding a defect for a day
8.8  measure a larger VS Code Test Explorer HARMLESS pool before raising its cap
     └─ current default is min(4, cpus - 1); compare 4, 6 and 8 on the same
        tree, recording total wall time, peak RSS, CPU and identical outcomes
     └─ only 9 objects use the parallel lane; the other 14 run alone, so
        measure the whole run as well as the HARMLESS lane
     └─ keep debug and shared HANA/Postgres test schemas at one: each child
        writes startup seed rows even when its test declares HARMLESS;
        SQLite and DuckDB get a separate temporary database file per child
8.9  isolated remote-database slots for ABAP Unit, if HANA/Postgres runs need parallelism
     └─ propose server cap OSD_UNIT_DB_SLOTS=1 by default and a VS Code
        setting for the next test run; derive short, collision-resistant
        __UNIT_01..N names from HANA_SCHEMA or PGDATABASE, leaving the base
        untouched. No RZ10/RZ11-like editor exists today
     └─ first prove HARMLESS can share one prepared read-only schema: skip
        per-child startup reseed and retain the runtime write guard from
        class_setup through class_teardown; verify no other boot writes
     └─ lease one slot per child; return it only after verified reset on
        completion, cancellation or failure, otherwise quarantine that slot;
        a changed slot count takes effect after active runs drain
     └─ HANA can use schemas; the current PostgreSQL client uses public in a
        dedicated database, so PostgreSQL needs a pool of databases or a
        deliberate client change before it can use schemas
     └─ DANGEROUS tests with proven database-only effects may use isolated
        slots; dynamic/unknown effects and CRITICAL stay serial by default.
        A test can COMMIT WORK, so compare snapshot restore with drop/reseed
        on a real backend; prove crash recovery and schema-version checks
        before reusing a slot, then measure two slots against serial wall time
```

## Test isolation fixture repairs

- <a id="isolation-adt-facade-temporary-roots"></a> `test/adt-facade.mjs` — `temporary-roots`; evidence: the program subroutines/events/local-classes case creates osd-parts-* at test/adt-facade.mjs:527 and never removes it. Confirmed in the shared ADT mode-0 run on base 11122e9f. The detector still prints the surviving root; repair belongs to the fixture owner. Owner: **adt-i5**.

- <a id="isolation-osd-store-temporary-roots"></a> `test/osd-store.mjs` — `temporary-roots`; evidence: the CRLF formatting fixture at test/osd-store.mjs:478 creates osd-crlf-* without a finally/after removal. Shard 1 on base 11122e9f observed one surviving root; the fixture owner must restore isolation. Owner: **stoker**.

- <a id="isolation-prove-inplace-temporary-roots"></a> `test/prove-inplace.mjs` — `temporary-roots`; evidence: run() at test/prove-inplace.mjs:304 defaults to a fresh osd-prove-inplace-* directory and does not remove it; the explicit runs directory near line 688 also survives. Shard 1 on base 11122e9f observed 31 roots. Keep evidence visible until the fixture owner fixes cleanup. Owner: **stoker**.

- <a id="isolation-vscode-warm-generation"></a> `test/vscode-warm.mjs` — `generation`; evidence: the shared shard-1 run changed live from 759177bda0d12f33 to ee8b686b9cf3721d, then restored source bytes without restoring the live generation. The final tree still hashes to 759177bda0d12f33. Confirmed on base 11122e9f; fixture owner must restore both. Owner: **stoker**.

- <a id="isolation-dsl-l2-generation"></a> `test/dsl-l2.mjs` — `generation`; evidence: setup at test/dsl-l2.mjs:112 writes 13 previously absent ignored trace.meta.json sidecars under src/l2demo and leaves live at 759177bda0d12f33 while the tree becomes a1e53ac46cfb6ea1. A read-only hash excluding exactly those 13 files returns 759177bda0d12f33. Recorded in shard 2 on base 11122e9f; no cleanup/rebuild is performed by the detector. Owner: **stoker**.

- <a id="isolation-osd-bsp-temporary-roots"></a> `test/osd-bsp.mjs` — `temporary-roots`; evidence: the osd-bsp fixture creates an osd-bsp-* root and leaves it on disk. Shared shard 2 on base 11122e9f observed one survivor; the fixture owner must remove it. Owner: **stoker**.

- <a id="isolation-vscode-job-worker-integration-generation"></a> `test/vscode-job-worker-integration.mjs` — `generation`; evidence: this fixture starts Launcher over process.cwd() with a disposable notebook pack, activates its class and removes the pack in finally, but leaves the repository live link at e5315ee4149d11ec while the restored tree hashes to a1e53ac46cfb6ea1. A second originating generation leak in shard 2 on base 11122e9f. Owner: **stoker**.

- <a id="isolation-amdp-pack-temporary-roots"></a> `test/amdp-pack.mjs` — `temporary-roots`; evidence: shared shard 4 on base 11122e9f observed one osd-amdp-pack-* fixture root still present at the file boundary. The generated AMDP pack fixture has no removal; repair belongs to its test owner. The detector retains the full root evidence. Owner: **stoker**.

- <a id="isolation-segw-tree-temporary-roots"></a> `test/segw-tree.mjs` — `temporary-roots`; evidence: shard 4 on base 11122e9f left one segw-repo-* directory when spawnSync zip failed with ENOENT. tools/segw-tree.mjs:401 creates the root but line 411 removes it only after successful zipFolder(), not in finally. This records the measured error-path leak; the ordinary missing-zip test failure remains red. Owner: **stoker**.

- <a id="isolation-stg-compile-temporary-roots"></a> `test/stg-compile.mjs` — `temporary-roots`; evidence: the hand-written DPC_EXT beside a pack model case at test/stg-compile.mjs:409 creates stg-pack-src-* without a finally/after removal. Shard 4 on base 11122e9f observed one surviving root. Leave evidence visible until the fixture owner fixes it. Owner: **stoker**.

- <a id="isolation-generation-diff-temporary-roots"></a> `test/generation-diff.mjs` — `temporary-roots`; evidence: fixture() at test/generation-diff.mjs:23 creates gen-* roots and returns them without cleanup. Shared shard 3 on base 11122e9f observed 17 roots, including the standalone fixture near line 117. Owner: **stoker**.

- <a id="isolation-osd-routes-temporary-roots"></a> `test/osd-routes.mjs` — `temporary-roots`; evidence: the isolated route inventory case at test/osd-routes.mjs:56 creates osd-routes-* without cleanup. Shared shard 3 on base 11122e9f observed one surviving root. Owner: **stoker**.

- <a id="isolation-prove-on-system-temporary-roots"></a> `test/prove-on-system.mjs` — `temporary-roots`; evidence: fake-system proof cases use run() at test/prove-on-system.mjs:364 and explicit receipt directories, each creating osd-prove-runs-* without removal. Shared shard 3 on base 11122e9f observed 80 roots. Receipt cleanup belongs to the fixture owner. Owner: **stoker**.
