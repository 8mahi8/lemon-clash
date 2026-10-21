/* Online lab smoke: no Firebase is contacted until a dedicated project is configured.
   Runs in actual WebKit locally / GitHub Actions after Playwright install. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { webkit } = require("playwright");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const name = (req.url || "/").split("?")[0];
  if (name === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  const file = path.resolve(root, name === "/online" ? "online.html" :
    name === "/embed-online" ? "dist/lemon-clash-online-lab-embed.html" :
    name.replace(/^\/+/, ""));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader("Content-Type", file.endsWith(".js") ?
    "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(8783, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    for (const profile of [
      { name: "ipad", width: 1194, height: 834 },
      { name: "compact", width: 900, height: 520 }
    ]) {
      const ctx = await browser.newContext({ viewport: profile, hasTouch: true, locale: "ja-JP" });
      const page = await ctx.newPage(), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto("http://127.0.0.1:8783/online");
      assert.equal(await page.locator("#onlineHost").isVisible(), true);
      assert.equal(await page.locator("#onlineJoin").isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 3));
      assert.match(await page.locator("#onlineError").innerText(),/部屋を作る/);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 },
      hasTouch: true, locale: "ja-JP" });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setContent('<iframe id="site" sandbox="allow-scripts allow-same-origin" ' +
      'style="width:900px;height:520px;border:0" src="http://127.0.0.1:8783/embed-online"></iframe>');
    const inside = page.frameLocator("#site");
    assert.equal(await inside.locator("#onlineHost").isVisible(),true);
    assert.match(await inside.locator("#onlineError").innerText(), /部屋を作る/);
    assert.deepEqual(errors, []);
    await ctx.close();
    console.log("PASS preconfigured online UI and Google Sites-like iframe rendering");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
