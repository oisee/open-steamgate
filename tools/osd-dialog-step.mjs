// The end of a dialog step, for every host that runs the ABAP.
//
// An AS ABAP commits the database implicitly when a request's work is done
// and rolls it back when the request ends in an uncaught exception. A DPC
// that inserts without a COMMIT WORK of its own relies on the first half;
// the transactional bracket in ZCL_STG_HTTP_HANDLER relies on the second,
// because an exception nobody declared -- a conversion, a missing line, a
// zero divide -- unwinds straight past its ROLLBACK WORK.
//
// This is the kernel's job and not the application's: on a system such an
// exception is a short dump, and a dump ends the LUW. So the rule lives
// here, in one file, rather than in the ABAP -- and rather than in one host
// out of three, which is how it was until 2026-09-18. tools/osd-serve.mjs
// had it; test/start.mjs's inline front and web/preview-backend.mjs did
// not, so there a request that dumped left its rows pending on the
// connection and the *next* modifying request's fencing COMMIT WORK made
// them permanent. test/mocha.mjs, "a request that dumps leaves nothing
// behind", is that half-write.
const connection = () => globalThis.abap.context.databaseConnections.DEFAULT;

export async function dialogStep(work) {
  try {
    const result = await work();
    await connection().commit?.();
    return result;
  } catch (e) {
    await connection().rollback?.();
    throw e;
  }
}
