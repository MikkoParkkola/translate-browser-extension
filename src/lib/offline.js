function isOfflineError(err) {
  const online = globalThis.navigator?.onLine ?? true;
  return !online || (err && /network|fetch/i.test(err.message || ''));
}

if (typeof module !== 'undefined') module.exports = { isOfflineError };
if (typeof self !== 'undefined') self.isOfflineError = isOfflineError;
