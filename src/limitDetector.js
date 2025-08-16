let findLimitFn;
if (typeof findLimit === 'function') {
  findLimitFn = findLimit;
} else if (typeof require !== 'undefined') {
  findLimitFn = require('./findLimit');
} else if (typeof window !== 'undefined' && window.qwenFindLimit) {
  findLimitFn = window.qwenFindLimit;
} else {
  findLimitFn = async () => 0;
}

async function detectTokenLimit(translate, { start = 256, max = 8192 } = {}) {
  return findLimitFn(async n => {
    const text = 'x'.repeat(n);
    await translate(text);
    return true;
  }, { start, max });
}

async function detectRequestLimit(translate, { start = 1, max = 120 } = {}) {
  return findLimitFn(async n => {
    for (let i = 0; i < n; i++) {
      try {
        await translate(i);
      } catch {
        return false;
      }
    }
    return true;
  }, { start, max });
}

if (typeof module !== 'undefined') {
  module.exports = { detectTokenLimit, detectRequestLimit };
}

if (typeof window !== 'undefined') {
  window.qwenLimitDetector = { detectTokenLimit, detectRequestLimit };
}
