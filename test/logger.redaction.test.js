 // New file
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

   test('redacts values in object/array payloads (shallow and nested)', () => {
     const logger = require('../src/lib/logger.js');
     const log = logger.create('test');
     log.setLevel(3);

     log.error('oops', {
       headers: { Authorization: 'Bearer SECRET' },
       apiKey: 'K',
       nested: { list: [{ Authorization: 'X' }, { a: 1 }] },
     });

     const payload = outputs.find(([fn]) => fn === 'error')[1][1]; // second arg of error
     const dumped = JSON.stringify(payload);
     expect(dumped).toContain('"Authorization":"<redacted>"');
     expect(dumped).toContain('"apiKey":"<redacted>"');
     expect(dumped).not.toContain('SECRET');
     expect(dumped).not.toContain('"X"');
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
