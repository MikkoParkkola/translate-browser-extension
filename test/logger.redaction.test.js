// @jest-environment node

 describe('logger redaction and levels', () => {
   const origConsole = { ...console };
   let outputs;

   function spy() {
     outputs = [];
     ['debug', 'info', 'warn', 'error'].forEach(fn => {
       console[fn] = (...args) => outputs.push([fn, args]);
     });
   }
   function restore() {
     Object.assign(console, origConsole);
   }

   beforeEach(() => {
     jest.resetModules();
     restore();
     spy();
   });

   afterAll(() => {
     restore();
   });

  test('redacts Authorization and apiKey in strings at all levels', () => {
    const logger = require('../src/lib/logger.js');
    const log = logger.create('test');
    log.setLevel(3); // debug

    log.debug('Authorization: Bearer abc.123', 'apiKey=xyz-789', 'Api-Key : MYKEY');
    log.info('authorization=token', 'Api Key: secret');
    log.warn('Api-Key=Z');
    log.error('Authorization: Basic foobar');

    const flat = outputs.flatMap(([_, args]) => args.join(' ')).join(' ');
    expect(flat).toMatch(/Authorization\s*[=:]\s*<redacted>/i);
    expect(flat).toMatch(/api[-_\s]?key\s*[=:]\s*<redacted>/i);
    expect(flat).not.toMatch(/abc\.123|xyz-789|MYKEY|token|secret|foobar/);
  });

  test('redacts values in deeply nested structures and arrays', () => {
    const logger = require('../src/lib/logger.js');
    const log = logger.create('test');
    log.setLevel(3);

    const err = new Error('Authorization: Bearer SECRET and apiKey=ERRKEY');
    err.authorization = 'Bearer TOKEN';
    err.apiKey = 'ERRKEY2';
    err.info = { headers: [{ Authorization: 'SECRET2' }, 'apiKey=INNER'] };

    log.error('oops', {
      headers: { Authorization: 'Bearer SECRET' },
      apiKey: 'K',
      nested: {
        list: [
          { Authorization: 'X' },
          ['apiKey=Y', { deeper: { Authorization: 'Z' } }],
          err,
        ],
      },
    });

    const payload = outputs.find(([fn]) => fn === 'error')[1][1];
    const dumped = JSON.stringify(payload);
    expect(dumped).toMatch(/"Authorization":"<redacted>"/g);
    expect(dumped).toMatch(/"apiKey":"<redacted>"/g);
    expect(dumped).not.toMatch(/SECRET|ERRKEY|ERRKEY2|TOKEN|INNER|SECRET2|"K"|"X"|"Y"|"Z"/);
  });

  test('redacts Error object fields and preserves message and stack', () => {
    const logger = require('../src/lib/logger.js');
    const log = logger.create('test');
    const err = new Error('Authorization: Bearer SECRET and apiKey=ERR');
    err.apiKey = 'SECRETKEY';
    err.authorization = 'Bearer TOKEN';
    err.meta = { apiKey: 'METAKEY' };
    log.error('fail', err);

    const payload = outputs.find(([fn]) => fn === 'error')[1][1];
    expect(payload.message).toBe('Authorization: <redacted>');
    expect(payload.stack).toContain('Authorization: <redacted>');
    const str = JSON.stringify(payload);
    expect(str).not.toMatch(/SECRET|ERR|SECRETKEY|TOKEN|METAKEY/);
    expect(str).toMatch(/<redacted>/);
  });

  test('collectors receive redacted payloads', () => {
    const logger = require('../src/lib/logger.js');
    const collected = [];
    const remove = logger.addCollector(e => collected.push(e));
    const log = logger.create('test');
    log.setLevel(3);

    const err = new Error('Authorization: Bearer SECRET');
    err.apiKey = 'ERRKEY';

    log.info('msg', ['apiKey=ARR', { Authorization: 'HEAD', err }]);
    remove();

    expect(collected).toHaveLength(1);
    const dump = JSON.stringify(collected[0].args);
    expect(dump).toMatch(/<redacted>/);
    expect(dump).not.toMatch(/SECRET|ERRKEY|ARR|HEAD/);
  });

  test('redacts tokens in strings and objects', () => {
    const logger = require('../src/lib/logger.js');
    const log = logger.create('test');
    log.setLevel(3);

    log.debug('token=abc123', 'Bearer token: secret');
    log.info('accessToken: xyz', { refresh_token: 'foo' });

    const flat = outputs
      .flatMap(([_, args]) => args)
      .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    expect(flat).toMatch(/token\s*[=:]\s*<redacted>/i);
    expect(flat).not.toMatch(/abc123|secret|xyz|foo/);
  });

  test('parseLevel handles numbers and strings', () => {
    const { parseLevel } = require('../src/lib/logger.js');
    expect(parseLevel('debug')).toBe(3);
    expect(parseLevel('INFO')).toBe(2);
    expect(parseLevel('warn')).toBe(1);
    expect(parseLevel('error')).toBe(0);
    expect(parseLevel(2)).toBe(2);
    expect(parseLevel(99)).toBe(3);
    expect(parseLevel(-1)).toBe(0);
  });
 });
