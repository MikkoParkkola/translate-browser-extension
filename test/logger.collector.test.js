const logger = require('../src/lib/logger');

test('collects redacted entries', () => {
  const logs = [];
  const remove = logger.addCollector(e => logs.push(e));
  const l = logger.create('t');
  l.setLevel('debug');
  l.info('apiKey: 123', { authorization: 'Bearer token' });
  remove();
  expect(logs).toHaveLength(1);
  const entry = logs[0];
  expect(entry.level).toBe('info');
  const str = JSON.stringify(entry.args);
  expect(str).not.toMatch(/123|token/);
  expect(str).toMatch(/<redacted>/);
});
