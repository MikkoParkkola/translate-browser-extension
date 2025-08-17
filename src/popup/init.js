window.addEventListener('DOMContentLoaded', () => {
  const load = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  load('../languages.js').then(() => load('home.js'));
});
