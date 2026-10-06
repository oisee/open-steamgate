// Reap resources after a failed probe without replacing its useful error.
export async function withCleanup(body, cleanup) {
  let primary;
  try {
    return await body();
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (primary === undefined) throw error;
      // The body's failure stays the one thrown. Annotating it is best effort:
      // a primitive or a frozen error cannot carry the note, and an attempt
      // that throws must not replace it.
      try {
        primary.cleanupError = error;
        primary.message += `\nAdditionally, cleanup failed: ${error?.message ?? error}`;
        primary.stack += `\nCleanup failure: ${error?.stack ?? error}`;
      } catch {
        console.error(`cleanup failed after an earlier failure: ${error?.stack ?? error}`);
      }
    }
  }
}
