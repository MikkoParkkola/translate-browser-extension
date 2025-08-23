// src/options.js

document.addEventListener('DOMContentLoaded', () => {
  const addProviderButton = document.getElementById('addProvider');
  const addProviderOverlay = document.getElementById('addProviderOverlay');
  const cancelButton = document.getElementById('ap_cancel1');

  addProviderButton.addEventListener('click', () => {
    addProviderOverlay.style.display = 'flex';
  });

  cancelButton.addEventListener('click', () => {
    addProviderOverlay.style.display = 'none';
  });
});
