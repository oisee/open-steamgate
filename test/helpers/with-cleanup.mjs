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
      primary.cleanupError = error;
      primary.message += `\nAdditionally, cleanup failed: ${error.message}`;
      primary.stack += `\nCleanup failure: ${error.stack}`;
    }
  }
}
