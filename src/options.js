const apiKeyInput = document.getElementById('apiKey');
const endpointInput = document.getElementById('apiEndpoint');
const modelSelect = document.getElementById('model');
const targetSelect = document.getElementById('target');
const ignoredSelect = document.getElementById('ignored');
const autoCheckbox = document.getElementById('auto');
const msg = document.getElementById('msg');

function populateLanguages() {
  window.qwenLanguages.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code; opt.textContent = l.name;
    targetSelect.appendChild(opt.cloneNode(true));
    ignoredSelect.appendChild(opt);
  });
}

async function fetchModels() {
  const endpoint = endpointInput.value;
  const key = apiKeyInput.value;
  try {
    const res = await fetch(`${endpoint}services/aigc/mt/models`, {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!res.ok) throw new Error('Failed fetching models');
    const data = await res.json();
    modelSelect.innerHTML = '';
    data.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.model; opt.textContent = m.model;
      modelSelect.appendChild(opt);
    });
  } catch (e) {
    msg.textContent = e.message;
  }
}

document.getElementById('refresh').addEventListener('click', fetchModels);

populateLanguages();

window.qwenLoadConfig().then(cfg => {
  apiKeyInput.value = cfg.apiKey;
  endpointInput.value = cfg.apiEndpoint;
  autoCheckbox.checked = cfg.autoTranslate;
  targetSelect.value = cfg.targetLanguage;
  cfg.ignoredLanguages.forEach(l => {
    const opt = [...ignoredSelect.options].find(o => o.value === l);
    if (opt) opt.selected = true;
  });
  fetchModels().then(() => {
    modelSelect.value = cfg.model;
  });
});

document.getElementById('save').addEventListener('click', () => {
  const cfg = {
    apiKey: apiKeyInput.value.trim(),
    apiEndpoint: endpointInput.value.trim(),
    model: modelSelect.value,
    targetLanguage: targetSelect.value,
    ignoredLanguages: [...ignoredSelect.selectedOptions].map(o => o.value),
    autoTranslate: autoCheckbox.checked
  };
  window.qwenSaveConfig(cfg).then(() => {
    msg.textContent = 'Saved';
  });
});
