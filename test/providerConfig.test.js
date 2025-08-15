const { applyProviderConfig } = require('../src/providerConfig');

test('hides unused fields based on provider config', () => {
  document.body.innerHTML = `
    <label data-field="apiKey"></label><input data-field="apiKey">
    <label data-field="apiEndpoint"></label><input data-field="apiEndpoint">
    <label data-field="model"></label><select data-field="model"></select>
    <label data-field="projectId"></label><input data-field="projectId">
    <label data-field="location"></label><input data-field="location">
    <label data-field="documentModel"></label><input data-field="documentModel">
  `;
  const provider = { configFields: ['apiKey'] };
  applyProviderConfig(provider, document);
  expect(document.querySelector('[data-field="apiKey"]').style.display).toBe('');
  document
    .querySelectorAll(
      [
        '[data-field="apiEndpoint"]',
        '[data-field="model"]',
        '[data-field="projectId"]',
        '[data-field="location"]',
        '[data-field="documentModel"]',
      ].join(', ')
    )
    .forEach(el => {
      expect(el.style.display).toBe('none');
    });
});

