# The AMDP oracle: three systems, one method

**Why it exists.** About our AMDP path we could say "it works". That is not a
claim a maintainer can check. With an oracle we can say *"it agrees with a
real system on this set of cases, and here is where it does not"* — and the
second claim is checkable **without raising a HANA**, because it is a table of
divergences rather than a suite to run. For an upstream proposal that is the
whole difference: the evidence stops requiring the hardware.

The shape is the demo oracle of [`frame-comparison.md`](frame-comparison.md)
and the first sieve of `tools/osd-compare.mjs`. Same ABAP, two systems, and
the instrument names **the case** where the answers parted.

## The three columns, and what each one actually costs

| column | what runs | state |
| --- | --- | --- |
| `a4h` | the method compiled as the AMDP it is, on a real system's HANA | the oracle; needs the sandbox, asked for each time |
| `hxe` | our path: cut the body out, deploy the procedure, call it | **working** |
| `abap` | the ABAP twin of the method, where one exists | honestly almost always empty |

The third column is the one to be clear about. There is no SQLScript → Open
SQL translator and there will not be one — it was ruled out as too large — so
`abap` is fillable only where a method has a hand-written twin, which in real
code happens at a `cl_abap_dbfeatures` fork. Everywhere else it records
`skipped` with a reason. That is a **third value, not a zero**: "we never
asked" and "we asked and got nothing" are different facts and a report that
prints them the same way will be misread.

The `a4h` column is the same: today it records `A4H not connected in this
run`, because the sandbox is asked for each time. A report built now says
*not attempted* in that column rather than leaving a gap a reader will fill
with a guess.

## Two rules inherited, and both are about restraint

**Calibration before belief.** One target recorded twice must compare empty.
If it does not, the normalisation is wrong and no other number in the report
means anything.

```
$ node tools/amdp-oracle.mjs calibrate test/fixtures/amdp/demo-cases.json --target hxe
calibration, hxe against itself:
5 agreed · 0 diverged · 0 not comparable · 0 in one file only

No divergence found across 5 comparable cases.
```

**No masking rule is predicted.** `RULES` is empty, on purpose, and
`amdp-oracle.mjs rules` says so out loud. Every normaliser that ever lands
there arrives from a calibration run that failed without it, carries the
reason in `why`, and is **reported when it fires** — because "identical" and
"identical after we masked four fields" are different claims.

The first calibration above needed none, which is itself a measurement: our
deploy-and-call path is deterministic across connections for these cases.

## The counts do not collapse into one

`same · diverged · not comparable · in one file only`. The last is **our**
defect and not the systems' — it means the two runs were made from different
case lists — so it is counted apart.

Only `diverged == 0` **with** `same > 0` signs *"no divergence found"*. A run
where nothing was comparable agrees about nothing, and the report says

```
Nothing was comparable, so nothing agreed. This is not a pass.
```

rather than printing a clean tick. There is a test for exactly that line, and
one that plants a wrong cell and requires the instrument to see it —
backlog 8.4's standing reason: **a green that cannot go red measures nothing.**

## Using it

```
node tools/amdp-oracle.mjs record <cases.json> --target hxe --out a.ndjson
node tools/amdp-oracle.mjs record <cases.json> --target a4h --out b.ndjson
node tools/amdp-oracle.mjs compare a.ndjson b.ndjson
node tools/amdp-oracle.mjs calibrate <cases.json> --target hxe
node tools/amdp-oracle.mjs rules
```

A case file names the class and a list of calls; `test/fixtures/amdp/demo-cases.json`
is the worked one, five cases over `ZCL_OSD_AMDP_DEMO=>SQUARES` including the
empty and the negative count. Recordings go under `.local/`; `compare` exits
non-zero when anything diverged, so it can be a gate.

Suite: `test/amdp-oracle.mjs` (in `test/suites.json`, so `npm run integration`
runs it). It needs no HANA — the live half is `calibrate`, run by hand where
there is one.
