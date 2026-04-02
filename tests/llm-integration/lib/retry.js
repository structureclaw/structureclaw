const MAX_ATTEMPTS = 4; // 1 initial + 3 retries

/**
 * Retry an async function up to MAX_ATTEMPTS times.
 * Logs each retry attempt with the error message.
 * Returns the result on success; throws the last error on final failure.
 */
async function withRetry(fn, label = "test") {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `  [RETRY] ${label} (attempt ${attempt}/${MAX_ATTEMPTS}) — ${msg}\n`
      );
    }
  }
}

/**
 * Run a test case with retry logic. Returns { passed, attempts, lastError }.
 */
async function runWithRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      return { passed: true, attempts: attempt, lastError: null, result };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        process.stdout.write(
          `  [RETRY] ${label} (attempt ${attempt}/${MAX_ATTEMPTS}) — ${lastError.message}\n`
        );
      }
    }
  }
  return { passed: false, attempts: MAX_ATTEMPTS, lastError, result: null };
}

module.exports = { withRetry, runWithRetry, MAX_ATTEMPTS };
