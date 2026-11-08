# tools/rap-flight

The host side of `packs/rap-flight` (SAP's RAP flight reference scenario as
a fetched pack, [docs/rap-flight-pack.md](../../docs/rap-flight-pack.md)).

`seed-capture.mjs` boots the transpiled runtime, runs the pack's seed class
(`ZCL_OSD_RAPFLIGHT_SEED`, which runs SAP's own data generator) inside one
dialog step and writes every table the generator fills into
`packs/rap-flight/data/*.tabu.json`, abapGit's TABU form with ISO dates, the
same format the other packs' seed rows have.

```
npm run transpile
node tools/rap-flight/seed-capture.mjs [--out packs/rap-flight/data]
```

Depends on `tools/osd-dialog-step.mjs` only; the tables it writes are listed
in `TABLES` at the top of the file. `test/rap-flight-pack.mjs` checks the
manifest; the capture is run by hand when the generator or its tables change.
