// src/options.js

document.addEventListener('DOMContentLoaded', () => {
  const addProviderButton = document.getElementById('addProvider');
  const addProviderOverlay = document.getElementById('addProviderOverlay');
  const cancelAddProviderButton = document.getElementById('ap_cancel1');
  const nextButton = document.getElementById('ap_next');
  const backButton = document.getElementById('ap_back');
  const createButton = document.getElementById('ap_create');
  const providerList = document.getElementById('providerList');
  const apStep1 = document.getElementById('ap_step1');
  const apStep2 = document.getElementById('ap_step2');
  const apPreset = document.getElementById('ap_preset');
  const apFields = document.getElementById('ap_fields');

  let providers = [];

  async function initialize() {
    await loadProviders();
    setupEventListeners();
  }

  async function loadProviders() {
    const { localProviders } = await chrome.storage.local.get({ localProviders: [] });
    providers = localProviders;
    renderProviders();
  }

  function renderProviders() {
    providerList.innerHTML = '';
    providers.forEach((provider, index) => {
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.innerHTML = `<h2>${provider.name}</h2>`;
      card.addEventListener('click', () => editProvider(index));
      providerList.appendChild(card);
    });
  }

  function setupEventListeners() {
    addProviderButton.addEventListener('click', () => {
      apStep1.style.display = 'block';
      apStep2.style.display = 'none';
      addProviderOverlay.style.display = 'flex';
    });

    cancelAddProviderButton.addEventListener('click', () => {
      addProviderOverlay.style.display = 'none';
    });

    nextButton.addEventListener('click', () => {
      apStep1.style.display = 'none';
      apStep2.style.display = 'block';
      renderProviderFields(apPreset.value);
    });

    backButton.addEventListener('click', () => {
      apStep1.style.display = 'block';
      apStep2.style.display = 'none';
    });

    createButton.addEventListener('click', () => {
      const newProvider = {
        name: apPreset.value,
        // ... get other fields from the form
      };
      providers.push(newProvider);
      chrome.storage.local.set({ localProviders: providers });
      renderProviders();
      addProviderOverlay.style.display = 'none';
    });
  }

  function renderProviderFields(preset) {
    apFields.innerHTML = '';
    // ... logic to render the correct fields for each preset
  }

  function editProvider(index) {
    // ... logic to open the editor overlay and populate it with the provider data
  }

  initialize();
});
