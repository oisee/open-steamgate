# tools/rap-flight

The host side of `packs/rap-flight` (the RAP flight reference scenario as a
fetched pack, [docs/rap-flight-pack.md](../../docs/rap-flight-pack.md)).

`seed-capture.mjs` boots the transpiled runtime, runs the pack's seed class
(`ZCL_OSD_RAPFLIGHT_SEED`, which runs the scenario's own data generator)
inside one dialog step and writes every table the generator fills into
`packs/rap-flight/data/*.tabu.json`, abapGit's TABU form with ISO dates, the
same format the other packs' seed rows have.

The rows are generator output and are **not tracked** (the licence decision
of 2026-11-09: derived content of the fetched upstream stays out of the
repository). A build makes them: `tools/osd-build.mjs` calls
`ensurePackSeeds()` after the transpile whenever the inputs the generator
reads changed -- the upstream commit, the overlay's generator copies, the
seed class and this script -- with the digest of what a capture is a
function of in `data/.osd-seed.json`, beside the rows it explains. The
generator is random where the scenario is: the master data comes out the
same every run and the transactional counts do not, so a capture's counts
are one run's.

```
npm run transpile                           # captures when the inputs changed
node tools/rap-flight/seed-capture.mjs      # refresh on purpose, same output
node tools/rap-flight/seed-capture.mjs --out <dir>
```

Depends on `tools/osd-dialog-step.mjs` and `tools/osd-packs.mjs` only; the
tables it writes are listed in `TABLES` at the top of the file.
`test/rap-flight-pack.mjs` checks the manifest; `test/rap-flight-wire.mjs`
reads the rows over the wire.
