// Reap resources after a failed probe without replacing its useful error.
// Whatever the body threw (an Error, a frozen one, undefined, a symbol) stays
// the value thrown; a cleanup failure is attached when it can be and logged
// otherwise, and neither step may throw in its place.
const text = (value, key) => { try { return String(value?.[key] ?? value); } catch { return "<unprintable>"; } };
export async function withCleanup(body, cleanup) {
  let failed = false, primary;
  try {
    return await body();
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (!failed) throw error;
      try {
        primary.cleanupError = error;
        primary.message += `\nAdditionally, cleanup failed: ${text(error, "message")}`;
        primary.stack += `\nCleanup failure: ${text(error, "stack")}`;
      } catch {
        try { console.error(`cleanup failed after an earlier failure: ${text(error, "stack")}`); } catch { /* nothing left to report with */ }
      }
    }
  }
}
