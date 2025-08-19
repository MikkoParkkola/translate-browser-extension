const fs = require('fs');
const path = require('path');

function loadSnippet() {
  const code = fs.readFileSync(path.join(__dirname, '../src/mupdf.engine.js'), 'utf8');
  const globalMatch = code.match(/var \$libmupdf_js_event_listener[\s\S]*?globalThis\.\$libmupdf_js_event\s*=\s*function \([^]*?};/);
  const methodMatch = code.match(/setJSEventListener\(_listener\) \{[\s\S]*?\n\s*rearrangePages/);
  const methodBody = methodMatch[0].replace(/\n\s*rearrangePages[\s\S]*/, '');
  const final = `${globalMatch[0]}\nconst libmupdf = {};\nfunction setJSEventListener(_listener)${methodBody.split('setJSEventListener(_listener)')[1]}\nmodule.exports = { setJSEventListener, trigger: globalThis.$libmupdf_js_event };`;
  const module = { exports: {} };
  const fn = new Function('module', 'exports', final);
  fn(module, module.exports);
  return module.exports;
}

describe('setJSEventListener', () => {
  test('registers callback and forwards events', () => {
    const { setJSEventListener, trigger } = loadSnippet();
    const spy = jest.fn();
    setJSEventListener(spy);
    expect(() => trigger(1, 2, 3)).not.toThrow();
    expect(spy).toHaveBeenCalledWith(1, 2, 3);
    setJSEventListener(null);
    expect(() => trigger('test')).not.toThrow();
  });
});
