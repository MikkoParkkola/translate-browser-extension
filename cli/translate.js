#!/usr/bin/env node

const readline = require('readline');
const { configure } = require('../src/throttle');
const { modelTokenLimits } = require('../src/config');
const { qwenTranslateStream, qwenTranslate } = require('../src/translator');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-k' || a === '--key') opts.apiKey = args[++i];
    else if (a === '-e' || a === '--endpoint') opts.endpoint = args[++i];
    else if (a === '-m' || a === '--model') opts.model = args[++i];
    else if (a === '-s' || a === '--source') opts.source = args[++i];
    else if (a === '-t' || a === '--target') opts.target = args[++i];
    else if (a === '--requests') opts.requestLimit = parseInt(args[++i], 10);
    else if (a === '--tokens') opts.tokenLimit = parseInt(args[++i], 10);
    else if (a === '-d' || a === '--debug') opts.debug = true;
    else if (a === '--no-stream') opts.stream = false;
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  return opts;
}

async function main() {
  const DEFAULT_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/api/v1';
  const DEFAULT_MODEL = 'qwen-mt-turbo';
  const opts = parseArgs();

  if (opts.stream !== false) opts.stream = true;

  if (opts.help || !opts.apiKey || !opts.source || !opts.target) {
    console.log('Usage: node translate.js -k <apiKey> [-e endpoint] [-m model] [--requests N] [--tokens M] [-d] [--no-stream] -s <source> -t <target>');
    process.exit(opts.help ? 0 : 1);
  }

  opts.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  opts.model = opts.model || DEFAULT_MODEL;

  if (opts.debug) {
    console.error('\x1b[36mQTDEBUG: starting CLI with options', {
      endpoint: opts.endpoint,
      model: opts.model,
      source: opts.source,
      target: opts.target,
    }, '\x1b[0m');
  }

  configure({
    requestLimit: opts.requestLimit || 60,
    tokenLimit: opts.tokenLimit || modelTokenLimits[opts.model] || modelTokenLimits['qwen-mt-turbo'],
    windowMs: 60000,
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', async line => {
    line = line.trim();
    if (!line) { rl.prompt(); return; }
    try {
      if (opts.stream) {
        await qwenTranslateStream({ ...opts, text: line, debug: opts.debug, stream: true }, chunk => {
          if (opts.debug) console.error('\x1b[36mQTDEBUG: chunk received', chunk, '\x1b[0m');
          process.stdout.write(chunk);
        });
        process.stdout.write('\n');
      } else {
        const res = await qwenTranslate({ ...opts, text: line, debug: opts.debug, stream: false });
        process.stdout.write(res.text + '\n');
      }
    } catch (err) {
      console.error(err.stack || err.toString());
      process.exit(1);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('');
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err.stack || err.toString());
  process.exit(1);
});

