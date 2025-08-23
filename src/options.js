// src/options.js

document.addEventListener('DOMContentLoaded', () => {
  const addProviderButton = document.getElementById('addProvider');
  const addProviderOverlay = document.getElementById('addProviderOverlay');
  const cancelButton = document.getElementById('cancelAddProvider');
  const providerList = document.getElementById('providerList');

  async function initialize() {
    await loadProviders();
    setupEventListeners();
  }

  async function loadProviders() {
    const { providers } = await chrome.storage.local.get({ providers: [] });
    renderProviders(providers);
  }

  function renderProviders(providers) {
    providerList.innerHTML = '';
    providers.forEach(provider => {
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.innerHTML = `<h2>${provider.name}</h2>`;
      providerList.appendChild(card);
    });
  }

  function setupEventListeners() {
    addProviderButton.addEventListener('click', () => {
      addProviderOverlay.style.display = 'flex';
    });

    cancelButton.addEventListener('click', () => {
      addProviderOverlay.style.display = 'none';
    });
  }

  initialize();
});