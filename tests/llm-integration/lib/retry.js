const MAX_ATTEMPTS = 8; // 1 initial + 7 retries

function shouldRetryError(err) {
  const message = err instanceof Error ? err.message : String(err || "");

  if (!message) {
    return false;
  }

  return (
    /\b(408|409|425|429)\b/u.test(message)
    || /\b5\d{2}\b/u.test(message)
    || /rate limit/iu.test(message)
    || /quota exceeded/iu.test(message)
    || /temporarily unavailable/iu.test(message)
    || /overloaded/iu.test(message)
    || /timeout/iu.test(message)
    || /timed out/iu.test(message)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/u.test(message)
    || /socket hang up/iu.test(message)
  );
}

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
      if (attempt === maxAttempts || !shouldRetryError(err)) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `  [RETRY] ${label} (attempt ${attempt}/${maxAttempts}) — ${msg}\n`
      );
    }
  }
}

module.exports = { withRetry, MAX_ATTEMPTS, shouldRetryError };
