const MAX_ATTEMPTS = 4; // 1 initial + 3 retries

/**
 * Retry an async function up to MAX_ATTEMPTS times.
 * Logs each retry attempt with the error message.
 * Returns the result on success; throws the last error on final failure.
 */
async function withRetry(fn, label = "test", maxAttempts = MAX_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `  [RETRY] ${label} (attempt ${attempt}/${maxAttempts}) — ${msg}\n`
      );
    }
  }
}

module.exports = { withRetry, MAX_ATTEMPTS };
