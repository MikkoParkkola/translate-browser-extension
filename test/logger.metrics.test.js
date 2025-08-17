const logger = require('../src/lib/logger');

test('logs batch and queue metrics', () => {
  const logs = [];
  const remove = logger.addCollector(e => logs.push(e));
  const l = logger.create('m');
  l.setLevel('info');
  l.logBatchTime(10);
  l.logQueueLatency(5);
  remove();
  expect(logs).toHaveLength(2);
  expect(logs[0].args[0]).toEqual({ batchTimeMs: 10 });
  expect(logs[1].args[0]).toEqual({ queueLatencyMs: 5 });
});
