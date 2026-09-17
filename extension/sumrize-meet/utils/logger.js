/**
 * utils/logger.js
 * Logger universal untuk:
 * - Service Worker
 * - Content Script
 * - Popup
 */

const DEBUG = true;
const PREFIX = "[Sumrize]";

function formatLog(level, args) {
  return [`${PREFIX} ${level}`, ...args];
}

const SumrizeLogger = {
  debug(...args) {
    if (DEBUG) {
      console.debug(...formatLog("DEBUG", args));
    }
  },

  info(...args) {
    console.info(...formatLog("INFO", args));
  },

  warn(...args) {
    console.warn(...formatLog("WARN", args));
  },

  error(...args) {
    console.error(...formatLog("ERROR", args));
  }
};

// Untuk content script / global access
globalThis.SumrizeLogger = SumrizeLogger;