/**
 * adapters/http.js
 * HTTP fetch with timeout + retry
 */

const { NetworkError } = require("../utils/errors");

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 10000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new NetworkError(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw new NetworkError(`Request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}) {
  const {
    retries = 3,
    retryDelayMs = 1000,
    timeoutMs = 10000,
    ...rest
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithTimeout(url, { ...rest, timeoutMs });
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  throw lastError || new NetworkError(`Request failed after ${retries} attempts: ${url}`);
}

module.exports = {
  fetchWithTimeout,
  fetchWithRetry,
};
