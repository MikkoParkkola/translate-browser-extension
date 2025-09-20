(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenBackgroundMessaging = mod;
}(typeof self !== 'undefined' ? self : this, function () {
  function withLastError(callback, fallback) {
    return function handler(result) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        if (typeof callback === 'function') callback(null, chrome.runtime.lastError);
        return;
      }
      if (typeof callback === 'function') callback(result, null);
      else if (fallback !== undefined) return fallback;
    };
  }

  function sendMessage(message, expectResponse = true) {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return expectResponse ? Promise.resolve(null) : Promise.resolve();
    }

    return new Promise(resolve => {
      try {
        const maybePromise = chrome.runtime.sendMessage(message, withLastError(response => {
          resolve(response ?? null);
        }));

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(value => resolve(value ?? null)).catch(() => resolve(null));
        } else if (!expectResponse) {
          resolve();
        }
      } catch (error) {
        resolve(null);
      }
    });
  }

  function sendToTab(tabId, message, expectResponse = true) {
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
      return expectResponse ? Promise.resolve(null) : Promise.resolve();
    }

    return new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(tabId, message, withLastError(response => {
          resolve(response ?? null);
        }));
      } catch (error) {
        resolve(null);
      }
    });
  }

  function queryTabs(queryInfo) {
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
      return Promise.resolve([]);
    }

    return new Promise(resolve => {
      try {
        chrome.tabs.query(queryInfo || {}, tabs => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve([]);
          } else {
            resolve(tabs || []);
          }
        });
      } catch (error) {
        resolve([]);
      }
    });
  }

  function sendMessageSync(message, callback) {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      if (typeof callback === 'function') callback(null, new Error('runtime unavailable'));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, withLastError(callback));
    } catch (error) {
      if (typeof callback === 'function') callback(null, error);
    }
  }

  return { withLastError, sendMessage, sendMessageSync, sendToTab, queryTabs };
}));
