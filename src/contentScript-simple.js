/**
 * Legacy content script shim used by the simplified background worker.
 *
 * The real translation logic lives in `contentScript.js`. This shim only
 * exists to satisfy older tests and provide minimal fallbacks so the
 * background script can probe whether a page already has our scripts.
 */
(function () {
  if (typeof window === 'undefined') {
    return;
  }

  // Prevent duplicate injection.
  if (window.translationExtensionInitialized) {
    return;
  }
  window.translationExtensionInitialized = true;

  const logger = {
    info: (...args) => console.log('[ContentScriptStub]', ...args),
    warn: (...args) => console.warn('[ContentScriptStub]', ...args),
    error: (...args) => console.error('[ContentScriptStub]', ...args),
    debug: (...args) => console.debug('[ContentScriptStub]', ...args),
  };

  function resolveOfflineLabel() {
    try {
      if (window.qwenI18n && typeof window.qwenI18n.t === 'function') {
        const label = window.qwenI18n.t('popup.offline');
        if (label) return label;
      }
    } catch (error) {
      logger.debug('i18n lookup failed', error);
    }
    return 'Offline';
  }

  function updateStatusBanner(text) {
    let banner = document.getElementById('qwen-status');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'qwen-status';
      banner.setAttribute('role', 'status');
      banner.style.cssText = [
        'position: fixed',
        'bottom: 16px',
        'right: 16px',
        'background: rgba(0, 0, 0, 0.75)',
        'color: #fff',
        'padding: 8px 12px',
        'border-radius: 8px',
        'font-family: system-ui, sans-serif',
        'font-size: 13px',
        'z-index: 2147483647',
        'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3)'
      ].join(';');
      document.body.appendChild(banner);
    }
    banner.textContent = text;
  }

  function reportOffline(context) {
    const offlineLabel = resolveOfflineLabel();
    const statusText = `TRANSLATE! by Mikko: ${offlineLabel}`;
    updateStatusBanner(statusText);

    try {
      chrome.runtime.sendMessage({ action: 'translation-status', status: { offline: true }, context }, () => {});
    } catch (error) {
      logger.debug('translation-status send failed', error);
    }

    try {
      chrome.runtime.sendMessage({ action: 'popup-status', text: offlineLabel, error: true, context }, () => {});
    } catch (error) {
      logger.debug('popup-status send failed', error);
    }
  }

  function isOfflineError(error) {
    if (!error) return false;
    const message = String(error.message || error || '').toLowerCase();
    if (error.code === 'ERR_NETWORK') return true;
    return (
      message.includes('network') ||
      message.includes('offline') ||
      message.includes('failed to fetch') ||
      message.includes('no response from background script')
    );
  }

  async function translateSelection() {
    const selection = window.getSelection?.().toString().trim() || '';
    if (!selection) {
      return;
    }

    if (navigator?.onLine === false) {
      reportOffline('selection');
      return;
    }

    if (typeof window.qwenTranslate !== 'function') {
      return;
    }

    try {
      await window.qwenTranslate({ text: selection });
    } catch (error) {
      if (isOfflineError(error)) {
        reportOffline('selection');
      } else {
        logger.debug('selection translate failed', error);
      }
    }
  }

  function handleMessage(message, _sender, sendResponse) {
    const action = message?.type || message?.action;

    if (action === 'ping') {
      if (typeof sendResponse === 'function') {
        sendResponse({ success: true, pong: true });
      }
      return true;
    }

    if (action === 'test-read') {
      if (typeof sendResponse === 'function') {
        sendResponse({ success: true, title: document.title || '', url: location.href });
      }
      return true;
    }

    if (action === 'translateSelection') {
      translateSelection().catch(err => logger.debug('translateSelection error', err));
      if (typeof sendResponse === 'function') {
        sendResponse({ success: true });
      }
      return true;
    }

    return false;
  }

  try {
    chrome?.runtime?.onMessage?.addListener(handleMessage);
  } catch (error) {
    logger.debug('Unable to attach listener', error);
  }
})();
