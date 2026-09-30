# Channel models for D via DSL L1 (hand-written, stage 1)

- `zosd_t_amc.samc.model.json` renders byte-for-byte to `docs/probes/abap-daemons/zosd_t_amc.samc.xml`, the SAMC as
  abapGit serialised it on A4H (the authority for the real format: TEXT present, every AMC_CHNL_AUTH carries
  APPLICATION_ID, VERSION and NR; NR runs 1..n across the whole file in model order, not per channel).
- `zstg_apc_demo.sapc.model.json` renders to `src/apc/zstg_apc_demo.sapc.xml`.
- `program_id` is computed by the model builder (class name padded with '=' to 30, plus "CP"), per "the template
  renders, the model decides".
- Note: `src/amc/zstg_amc_test.samc.xml` is a hand-written simplified shape (no TEXT, no APPLICATION_ID/VERSION/NR on
  authorities, different indentation); it is not the format to target. It should be regenerated in the real shape once
  the recipe exists (runtime reader to be checked against the real shape first).
