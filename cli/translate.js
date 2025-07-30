#!/usr/bin/env node

const readline = require('readline');
const fetch = require('cross-fetch');
const { runWithRateLimit, approxTokens, configure } = require('../src/throttle');

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function translateStream({ endpoint, apiKey, model, text, source, target }, onData) {
  const url = `${withSlash(endpoint)}services/aigc/text-generation/generation`;
  const body = {
    model,
    input: { messages: [{ role: 'user', content: text }] },
    parameters: { translation_options: { source_lang: source, target_lang: target } },
  };
  const resp = await runWithRateLimit(
    () => fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify(body),
    }),
    approxTokens(text)
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(`HTTP ${resp.status}: ${err.message || 'Translation failed'}`);
  }

  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const data = await resp.json();
    if (data.output && data.output.text) onData(data.output.text);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        reader.cancel();
        return;
      }
      try {
        const obj = JSON.parse(data);
        if (obj.output && obj.output.text) onData(obj.output.text);
      } catch {}
    }
  }
}

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
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  return opts;
}

async function main() {
  const DEFAULT_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/api/v1';
  const DEFAULT_MODEL = 'qwen-mt-turbo';
  const opts = parseArgs();

  if (opts.help || !opts.apiKey || !opts.source || !opts.target) {
    console.log('Usage: node translate.js -k <apiKey> [-e endpoint] [-m model] [-\-requests N] [-\-tokens M] -s <source> -t <target>');
    process.exit(opts.help ? 0 : 1);
  }

  opts.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  opts.model = opts.model || DEFAULT_MODEL;

  configure({
    requestLimit: opts.requestLimit || 60,
    tokenLimit: opts.tokenLimit || 100000,
    windowMs: 60000,
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', async line => {
    line = line.trim();
    if (!line) { rl.prompt(); return; }
    try {
      await translateStream({ ...opts, text: line }, chunk => process.stdout.write(chunk));
      process.stdout.write('\n');
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

