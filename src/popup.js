window.qwenLoadConfig().then(cfg => {
  if (!cfg.apiKey) {
    document.getElementById('status').textContent = 'Set API key in options';
  }
});

document.getElementById('translate').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {action: 'start'});
  });
  document.getElementById('status').textContent = 'Translation started';
  console.log('Translate button clicked');
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
