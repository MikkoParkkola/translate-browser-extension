(async () => {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
  const { supporter } = await new Promise(resolve => chrome.storage.sync.get(['supporter'], resolve));
  const banner = document.createElement('div');
  banner.id = 'supportBanner';
  banner.style.cssText = 'font-size:0.75rem;background:var(--secondary-bg);border:1px solid var(--input-border);padding:4px;border-radius:4px;display:flex;gap:0.5rem;align-items:center;justify-content:center;margin-bottom:0.5rem;';
  const container = document.body;
  if (supporter) {
    banner.textContent = 'You rock!';
    container.prepend(banner);
    return;
  }
  const msg = document.createElement('span');
  msg.textContent = 'Support development:';
  banner.appendChild(msg);
  const donations = [
    {
      label: 'Coffee €5',
      links: [
        { label: 'PayPal', url: 'https://paypal.me/micc0z/5' },
        { label: 'Stripe', url: 'https://buy.stripe.com/test5' },
      ],
    },
    {
      label: 'Beer €7',
      links: [
        { label: 'PayPal', url: 'https://paypal.me/micc0z/7' },
        { label: 'Stripe', url: 'https://buy.stripe.com/test7' },
      ],
    },
    {
      label: 'Dinner €20',
      links: [
        { label: 'PayPal', url: 'https://paypal.me/micc0z/20' },
        { label: 'Stripe', url: 'https://buy.stripe.com/test20' },
      ],
    },
  ];
  donations.forEach(opt => {
    const wrap = document.createElement('span');
    wrap.textContent = opt.label + ': ';
    opt.links.forEach((lnk, idx) => {
      const a = document.createElement('a');
      a.textContent = lnk.label;
      a.href = lnk.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.color = 'var(--primary-color)';
      a.addEventListener('click', async e => {
        e.preventDefault();
        if (chrome?.tabs?.create) chrome.tabs.create({ url: lnk.url });
        await chrome.storage.sync.set({ supporter: true });
        banner.textContent = 'You rock!';
      });
      wrap.appendChild(a);
      if (idx < opt.links.length - 1) {
        wrap.appendChild(document.createTextNode('/'));
      }
    });
    banner.appendChild(wrap);
  });
  container.prepend(banner);
})();
