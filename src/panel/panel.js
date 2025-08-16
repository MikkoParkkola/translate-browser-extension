(function () {
  const list = document.getElementById('translations');
  const port = chrome.runtime.connect({ name: 'qwen-panel' });
  const entries = new Map();

  port.onMessage.addListener(msg => {
    if (!msg || !msg.action) return;
    const id = msg.requestId || Math.random().toString(36).slice(2);
    let entry = entries.get(id);
    if (!entry) {
      entry = document.createElement('div');
      entry.className = 'entry';
      entry.innerHTML = '<div class="original"></div><div class="translated"></div>';
      list.appendChild(entry);
      entries.set(id, entry);
    }
    const orig = entry.querySelector('.original');
    const trans = entry.querySelector('.translated');
    if (msg.text && !orig.textContent) orig.textContent = msg.text;
    if (msg.action === 'chat-chunk' && msg.chunk) {
      trans.textContent += msg.chunk;
    } else if (msg.action === 'chat-result' && msg.result && msg.result.text) {
      trans.textContent = msg.result.text;
    } else if (msg.action === 'chat-error' && msg.error) {
      trans.textContent = '[Error] ' + msg.error;
    }
    list.scrollTop = list.scrollHeight;
  });
})();
