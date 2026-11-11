import { launch, UI } from "./lib.mjs"; process.env.PROFILE ??= "/tmp/pw-profile-nofb";
const { browser, page } = await launch(); await page.goto(UI + "/#/hub"); await page.waitForTimeout(2000);
console.log(await page.evaluate(() => { const t = document.body.innerText; const re = /mock|offline|fallback|simplif|engine|adapter|not connected/ig; const out = []; let m; while ((m = re.exec(t)) && out.length < 6) out.push(t.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, " ")); return out; }));
await browser.close();
