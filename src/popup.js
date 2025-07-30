const apiKeyInput = document.getElementById('apiKey');
const endpointInput = document.getElementById('apiEndpoint');
const modelInput = document.getElementById('model');
const sourceSelect = document.getElementById('source');
const targetSelect = document.getElementById('target');
const reqLimitInput = document.getElementById('requestLimit');
const tokenLimitInput = document.getElementById('tokenLimit');
const autoCheckbox = document.getElementById('auto');
const debugCheckbox = document.getElementById('debug');
const status = document.getElementById('status');
const versionDiv = document.getElementById('version');

function populateLanguages() {
  window.qwenLanguages.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code; opt.textContent = l.name;
    sourceSelect.appendChild(opt.cloneNode(true));
    targetSelect.appendChild(opt);
  });
}

populateLanguages();

window.qwenLoadConfig().then(cfg => {
  apiKeyInput.value = cfg.apiKey;
  endpointInput.value = cfg.apiEndpoint;
  modelInput.value = cfg.model;
  sourceSelect.value = cfg.sourceLanguage;
  targetSelect.value = cfg.targetLanguage;
  reqLimitInput.value = cfg.requestLimit;
  tokenLimitInput.value = cfg.tokenLimit;
  autoCheckbox.checked = cfg.autoTranslate;
  debugCheckbox.checked = !!cfg.debug;
  if (!cfg.apiKey) status.textContent = 'Set API key';
});

versionDiv.textContent = `v${chrome.runtime.getManifest().version}`;

document.getElementById('translate').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {action: 'start'});
  });
});

document.getElementById('save').addEventListener('click', () => {
  const cfg = {
    apiKey: apiKeyInput.value.trim(),
    apiEndpoint: endpointInput.value.trim(),
    model: modelInput.value.trim(),
    sourceLanguage: sourceSelect.value,
    targetLanguage: targetSelect.value,
    requestLimit: parseInt(reqLimitInput.value, 10) || 60,
    tokenLimit: parseInt(tokenLimitInput.value, 10) || 100000,
    autoTranslate: autoCheckbox.checked,
    debug: debugCheckbox.checked,
  };
  window.qwenSaveConfig(cfg).then(() => {
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

document.getElementById('test').addEventListener('click', async () => {
  status.textContent = 'Testing...';
  console.log('QTDEBUG: starting configuration test');
  const timer = setTimeout(() => {
    console.error('QTERROR: configuration test timed out');
    status.textContent = 'Error: timeout';
  }, 15000);
  try {
    await window.qwenTranslate({
      endpoint: endpointInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      source: sourceSelect.value,
      text: 'hello',
      target: targetSelect.value,
      debug: debugCheckbox.checked,
    });
    status.textContent = 'Configuration OK';
    console.log('QTDEBUG: configuration test successful');
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    console.error('QTERROR: configuration test failed', e);
  }
  clearTimeout(timer);
});
