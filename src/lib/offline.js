function isOfflineError(err) {
  return !navigator.onLine || (err && /network|fetch/i.test(err.message || ''));
}

if (typeof module !== 'undefined') module.exports = { isOfflineError };
if (typeof self !== 'undefined') self.isOfflineError = isOfflineError;
