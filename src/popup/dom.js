const dom = {
  apiKeyInput: document.getElementById('apiKey'),
  endpointInput: document.getElementById('apiEndpoint'),
  modelInput: document.getElementById('model'),
  providerSelect: document.getElementById('provider'),
  sourceSelect: document.getElementById('source'),
  targetSelect: document.getElementById('target'),
  reqLimitInput: document.getElementById('requestLimit'),
  tokenLimitInput: document.getElementById('tokenLimit'),
  tokenBudgetInput: document.getElementById('tokenBudget'),
  autoCheckbox: document.getElementById('auto'),
  debugCheckbox: document.getElementById('debug'),
  lightModeCheckbox: document.getElementById('lightMode'),
  smartThrottleInput: document.getElementById('smartThrottle'),
  tokensPerReqInput: document.getElementById('tokensPerReq'),
  retryDelayInput: document.getElementById('retryDelay'),
  status: document.getElementById('status'),
  versionDiv: document.getElementById('version'),
  reqCount: document.getElementById('reqCount'),
  tokenCount: document.getElementById('tokenCount'),
  reqBar: document.getElementById('reqBar'),
  tokenBar: document.getElementById('tokenBar'),
  reqRemaining: document.getElementById('reqRemaining'),
  tokenRemaining: document.getElementById('tokenRemaining'),
  providerError: document.getElementById('providerError'),
  reqRemainingBar: document.getElementById('reqRemainingBar'),
  tokenRemainingBar: document.getElementById('tokenRemainingBar'),
  turboReq: document.getElementById('turboReq'),
  plusReq: document.getElementById('plusReq'),
  turboReqBar: document.getElementById('turboReqBar'),
  plusReqBar: document.getElementById('plusReqBar'),
  totalReq: document.getElementById('totalReq'),
  totalTok: document.getElementById('totalTok'),
  queueLen: document.getElementById('queueLen'),
  failedReq: document.getElementById('failedReq'),
  failedTok: document.getElementById('failedTok'),
  translateBtn: document.getElementById('translate'),
  testBtn: document.getElementById('test'),
  progressBar: document.getElementById('progress'),
  clearCacheBtn: document.getElementById('clearCache'),
  clearDomainBtn: document.getElementById('clearDomain'),
  clearPairBtn: document.getElementById('clearPair'),
  forceCheckbox: document.getElementById('force'),
  cacheSizeLabel: document.getElementById('cacheSize'),
  hitRateLabel: document.getElementById('hitRate'),
  domainCountsDiv: document.getElementById('domainCounts'),
  cacheLimitInput: document.getElementById('cacheSizeLimit'),
  cacheTTLInput: document.getElementById('cacheTTL'),
};

if (typeof window !== 'undefined') {
  window.qwenPopupDOM = dom;
}

if (typeof module !== 'undefined') {
  module.exports = dom;
}

