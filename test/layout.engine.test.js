const fs = require('fs');
const path = require('path');

function loadLayout() {
  const code = fs.readFileSync(path.join(__dirname, '../src/wasm/vendor/layout.engine.js'), 'utf8');
  const transformed = code
    .replace(/import[^\n]+engine\.js';/, '')
    .replace(/export\s+/g, '');
  const module = { exports: {} };
  const fn = new Function('require', 'module', 'exports', transformed + '\nreturn { dedupeItems, groupTextItems };');
  return fn(require, module, module.exports);
}

describe('dedupeItems', () => {
  it('removes overlapping duplicate text items', () => {
    const { dedupeItems } = loadLayout();
    const items = [
      { text: 'Hello', x: 10, y: 20, size: 12 },
      { text: 'Hello', x: 10.3, y: 20.4, size: 12 },
      { text: 'Hello', x: 100, y: 20, size: 12 },
      { text: 'World', x: 50, y: 60, size: 12 },
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(3);
    expect(out[0].text).toBe('Hello');
    expect(out[1].text).toBe('Hello');
    expect(out[2].text).toBe('World');
  });
});

describe('groupTextItems', () => {
  beforeAll(() => {
    global.pdfjsLib = { Util: { transform: (_v, t) => t } };
  });
  const viewport = { transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100, scale: 1 };
  const ctx = { fillStyle: '', fillRect: () => {} };
  it('splits items into separate lines when y differs enough', () => {
    const { groupTextItems } = loadLayout();
    const textContent = {
      items: [
        { str: 'foo', transform: [1, 0, 0, 1, 10, 90], width: 10 },
        { str: 'bar', transform: [1, 0, 0, 1, 10, 70], width: 10 },
      ],
    };
    const lines = groupTextItems(textContent, viewport, ctx);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('bar');
    expect(lines[1].text).toBe('foo');
  });
  it('joins items on same line when y close', () => {
    const { groupTextItems } = loadLayout();
    const textContent = {
      items: [
        { str: 'foo', transform: [1, 0, 0, 1, 10, 90], width: 10 },
        { str: 'bar', transform: [1, 0, 0, 1, 50, 89.6], width: 10 },
      ],
    };
    const lines = groupTextItems(textContent, viewport, ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('foo bar');
  });
});
