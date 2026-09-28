# Application log persistence: internal first slice

`ZCL_OSD_BAL_STORE` is an internal transaction-aware store for the measured
fleet BAL scenario. It writes headers and ordered items to client-dependent
`ZOSD_BAL_HDR` and `ZOSD_BAL_ITM` using the caller's ABAP database connection.
It never commits. A caller can `COMMIT WORK` or `ROLLBACK WORK`; a failed save
raises `ZCX_OSD_BAL`. The log handle is a UUID. `EXTERNAL_ID` is a search field,
not a unique key. `FIND` raises a not-found error for an exact search with no
match, matching the observed A4H behavior.

The A4H probe in [osg-demo](https://github.com/oisee/osg-demo/blob/main/docs/a4h-bal-probe.md)
also measured a dedicated second-connection save. This store does **not**
implement it. Its caller-owned transaction is the ordinary `SAVE_LOG` path.

`npm run test:bal-persist` builds this checkout, writes two success logs and
one error log into a disposable SQLite file, stops OSD, starts a new process
on that same file and reads all three logs with their item severity. The
ABAP Unit tests of `ZCL_OSD_BAL_STORE_TEST` are marked `DANGEROUS` because
they write database rows; the restart test provides the durable assertion
because ABAP Unit rolls its transaction back after each run.

This is not the public SAP-compatible `CL_BALI_*` contract yet. Before the
fleet demo can use BAL, add the measured header, item, filter and DB interfaces
on top of this store, validate `SAVE_LOG` rollback and read errors through
that surface, and run the demo's two-success/one-error acceptance after
restarting OSD. Wildcard filters, second connection, job assignment and
general SLG0 customizing are outside this first storage slice.
