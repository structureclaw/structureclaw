const MAX_ATTEMPTS = 3; // 1 initial + 2 retries

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
 * By default only transient upstream failures retry; runner-level callers can
 * opt into retrying every case failure to absorb LLM output drift.
 */
async function withRetry(fn, label = "test", maxAttempts = MAX_ATTEMPTS, options = {}) {
  const retryOnAnyError = options.retryOnAnyError === true;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || (!retryOnAnyError && !shouldRetryError(err))) {
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
