#!/usr/bin/env node
/*
  Updates SHA-256 hashes for WASM assets declared in src/wasm/engine.js
  Hashes local vendor files under src/wasm/vendor and injects/updates
  `sha256: '<hex>'` fields for matching entries in WASM_ASSETS.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.join(__dirname, '..');
const enginePath = path.join(repoRoot, 'src/wasm/engine.js');
const vendorDir = path.join(repoRoot, 'src/wasm/vendor');

function sha256File(p) {
  const buf = fs.readFileSync(p);
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  return h;
}

const targets = [
  'mupdf-wasm.wasm',
  'mupdf.wasm',
  'mupdf-wasm.js',
  'mupdf.engine.js',
  'pdfium.wasm',
  'pdfium.js',
  'pdfium.engine.js',
  'hb.wasm',
  'hb.js',
  'icu4x_segmenter.wasm',
  'icu4x_segmenter.js',
  'pdf-lib.js',
  'fonts/NotoSans-Regular.ttf',
  'fonts/NotoSans-Bold.ttf',
];

const hashes = {};
for (const rel of targets) {
  const p = path.join(vendorDir, rel);
  if (fs.existsSync(p)) {
    hashes[rel] = sha256File(p);
  }
}

let src = fs.readFileSync(enginePath, 'utf8');

function updateAssetEntry(text, assetPath, hash) {
  // Find the object literal for the path entry inside WASM_ASSETS
  const esc = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(\{[\\s\\S]*?path:\\s*['\"]${esc}['\"],[\\s\\S]*?)\}`, 'm');
  const m = text.match(re);
  if (!m) return text; // not found
  let block = m[1];
  if (/sha256\s*:/.test(block)) {
    block = block.replace(/sha256\s*:\s*['\"][a-f0-9]*['\"]/i, `sha256: '${hash}'`);
  } else {
    block = block.replace(/\s*$/, `, sha256: '${hash}'`);
  }
  const updated = text.replace(re, block + '}');
  return updated;
}

let updated = src;
for (const [rel, hash] of Object.entries(hashes)) {
  updated = updateAssetEntry(updated, rel, hash);
}

if (updated !== src) {
  fs.writeFileSync(enginePath, updated);
  console.log('Updated SHA-256 for assets:', Object.keys(hashes).join(', '));
} else {
  console.log('No changes made (entries not found or already up-to-date).');
}
