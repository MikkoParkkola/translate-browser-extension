const fs = require('fs');
const path = require('path');

describe('manifest permissions', () => {
  const manifests = [
    ['src', path.join(__dirname, '..', 'src', 'manifest.json')],
    ['dist', path.join(__dirname, '..', 'dist', 'manifest.json')],
  ];
  const REQUIRED_HOST = 'https://translate.googleapis.com/*';
  const REQUIRED_CONNECT = 'https://translate.googleapis.com';
  const REQUIRED_RESOURCE = 'core/cache-manager.js';

  test.each(manifests)('%s manifest includes Google Translate permissions', (_label, manifestPath) => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.host_permissions || []).toContain(REQUIRED_HOST);

    const csp = manifest.content_security_policy?.extension_pages || '';
    expect(csp.includes(REQUIRED_CONNECT)).toBe(true);

    const resources = (manifest.web_accessible_resources || [])
      .flatMap(entry => entry?.resources || []);
    expect(resources).toContain(REQUIRED_RESOURCE);
  });
});
