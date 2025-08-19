const fs = require('fs');
const path = require('path');

describe('apple theme snapshots', () => {
  const vars = [
    '--qwen-bg',
    '--qwen-text',
    '--qwen-border',
    '--qwen-error',
    '--qwen-input-bg',
    '--qwen-input-focus',
    '--qwen-primary-bg',
    '--qwen-primary-hover',
    '--qwen-secondary-bg',
    '--qwen-secondary-hover',
  ];

  beforeAll(() => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/styles/apple.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  });

  const snapshotFor = el => {
    const computed = getComputedStyle(el);
    const out = {};
    for (const v of vars) {
      out[v] = computed.getPropertyValue(v).trim();
    }
    return out;
  };

  test('dark mode', () => {
    const el = document.createElement('div');
    el.setAttribute('data-qwen-theme', 'apple');
    document.body.appendChild(el);
    expect(snapshotFor(el)).toMatchSnapshot();
  });

  test('light mode', () => {
    const el = document.createElement('div');
    el.setAttribute('data-qwen-theme', 'apple');
    el.setAttribute('data-qwen-color', 'light');
    document.body.appendChild(el);
    expect(snapshotFor(el)).toMatchSnapshot();
  });
});
