const messaging = require('../src/lib/messaging.js');

describe('messaging.validateMessage sanitize', () => {
  test('handles self-referential objects without infinite recursion', () => {
    const msg = { action: 'ping' };
    msg.self = msg;
    const out = messaging.validateMessage(msg);
    expect(out.ok).toBe(true);
    expect(out.msg.self).toBe('[Circular]');
  });
});
