const fs = require('fs');
const path = require('path');

describe('update feed', () => {
  test('manifest, package.json, and updates.xml versions align', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/manifest.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.update_url).toBe('https://raw.githubusercontent.com/MikkoParkkola/translate-browser-extension/main/updates.xml');
    const xml = fs.readFileSync(path.join(__dirname, '../updates.xml'), 'utf8');
    const versionMatch = xml.match(/updatecheck[^>]*version="([^"]+)"/);
    expect(versionMatch && versionMatch[1]).toBe(pkg.version);
    const codebaseMatch = xml.match(/codebase="([^"]+)"/);
    expect(codebaseMatch && codebaseMatch[1]).toContain(`translate-browser-extension-${pkg.version}.crx`);
  });
});
