# Application log persistence: fleet BAL subset

The `CL_BALI_*` facade in `src/bal` supports the measured fleet audit path:
create a header with object, subobject and external ID; append free-text items
with severity; save in the caller's ABAP transaction; find by descriptor; load
by handle; and read items with their creation timestamps in insertion order.
The header reports total and error item counts. `CX_BALI_RUNTIME` makes failed saves and missing exact-ID
searches visible to the caller.

`ZCL_OSD_BAL_STORE` is the internal transaction-aware store. It writes
client-dependent `ZOSD_BAL_HDR` and `ZOSD_BAL_ITM` rows and never commits.
`EXTERNAL_ID` is a search field, not a unique key. The handle is a UUID. A
caller can `COMMIT WORK` or `ROLLBACK WORK` after `SAVE_LOG`.

This is a deliberately narrow compatibility surface. The caller-owned
`SAVE_LOG` path is implemented. `SAVE_LOG_2ND_DB_CONNECTION`,
`USE_2ND_DB_CONNECTION` and application-job assignment raise explicit
unsupported errors. `READ_ONLY_HEADER` also raises an explicit unsupported
error. Filters use exact object, subobject and external
ID values; wildcard, range and timestamp filtering are not implemented.
SAP customizing validation and other item types are outside this slice.

The [A4H probe](https://github.com/oisee/osg-demo/blob/main/docs/a4h-bal-probe.md)
measured ordinary save, rollback, second-connection save and repeated external
IDs. OSD matches the tested ordinary transaction and repeated-ID behavior;
it does not yet match the second-connection path.

`npm run test:bal-persist` builds OSD, writes two success logs and one error
log through `CL_BALI_*` into a disposable SQLite file, stops OSD, starts a
new process on the same file and reads all three logs and nine items through
the public facade. `ZCL_OSD_BAL_STORE_TEST` includes a facade rollback check.
Its ABAP Unit tests are marked `DANGEROUS` because they write database rows;
ABAP Unit rolls its transaction back after each run, so the separate restart
test supplies the durable assertion.

## Upgrade boundary

This source slice is for fresh demo databases. Adding the two BAL tables changes
the generated schema; it is not an in-place upgrade for existing persistent
instances. The current SQLite file startup moves a mismatched database to a
`.drift` file and starts fresh (or refuses with `STG_DB_STRICT=1`). PostgreSQL,
DuckDB and HANA refuse an old schema or missing tables. The browser's stored
SQLite preview also has no upgrade path. Keep existing deployments on their
pinned build until an additive migration is implemented and tested for each
backend; do not publish this slice as an ordinary persistent-instance update.
