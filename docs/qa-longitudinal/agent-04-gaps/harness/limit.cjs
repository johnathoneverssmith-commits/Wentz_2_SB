const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    localStorage.clear();
    const out = {};
    // single-key limit (ASCII)
    let lo = 0, hi = 40_000_000;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; try { localStorage.setItem('probe', 'x'.repeat(m)); lo = m; } catch { hi = m - 1; } }
    out.singleKeyMaxChars = lo; localStorage.clear();
    // does a failed overwrite keep the old value?
    localStorage.setItem('k', 'a'.repeat(1000)); let threw = false;
    try { localStorage.setItem('k', 'b'.repeat(30_000_000)); } catch (e) { threw = e.name; }
    out.failedOverwrite = { threw, oldIntact: localStorage.getItem('k') === 'a'.repeat(1000) };
    localStorage.clear();
    return out;
  });
  console.log(b.version(), JSON.stringify(r));
  await b.close();
})();
