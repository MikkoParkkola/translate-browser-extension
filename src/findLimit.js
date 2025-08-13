function defaultCheck() { return Promise.resolve(false); }

async function findLimit(check = defaultCheck, { start = 1, max = 8192 } = {}) {
  if (start < 1) start = 1;
  let low = 0;
  let high = start;
  async function safe(n) {
    try { return await check(n); } catch { return false; }
  }
  while (high <= max && (await safe(high))) {
    low = high;
    high *= 2;
  }
  if (high > max) high = max + 1;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (mid > max || !(await safe(mid))) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return low;
}

if (typeof module !== 'undefined') module.exports = findLimit;
if (typeof window !== 'undefined') window.qwenFindLimit = findLimit;
