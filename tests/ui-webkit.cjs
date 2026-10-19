/**
 * Safari-like tablet browser QA for LEMON CLASH.
 * Run after node tools/build-embed.cjs:
 *   npm install --no-save --package-lock=false playwright@1.56.1
 *   npx playwright install webkit
 *   node tests/ui-webkit.cjs
 * Screenshots are saved only in the local CI artifact folder.
 */
"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { webkit } = require("playwright");

const root = path.resolve(__dirname, "..");
const screenshots = path.join(root, "artifacts", "ui-screens");
fs.mkdirSync(screenshots, { recursive: true });

const server = http.createServer((req, res) => {
  const name = (req.url || "/").split("?")[0];
  const relative = name === "/" ? "index.html" : name === "/embed" ?
    "dist/lemon-clash-embed.html" : decodeURIComponent(name).replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader("Content-Type", resolved.endsWith(".js") ?
    "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(resolved).pipe(res);
});

async function open(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: false, locale: "ja-JP"
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://127.0.0.1:8782/", { waitUntil: "load" });
  return { context, page, errors };
}

async function botLayout(browser, profile) {
  const { context, page, errors } = await open(browser, profile.width, profile.height);
  try {
    await page.locator("#botStart").click();
    assert.equal(await page.locator("#cards .move").count(), 11, "all eleven cards are present");
    assert.match(await page.locator("#myHp").innerText(), /5\/5/);
    assert.match(await page.locator("#opHp").innerText(), /5\/5/);
    assert.match(await page.locator("#myEn").innerText(), /1\/7/);
    assert.equal(await page.locator("#confirm").isDisabled(), true);

    const feint = page.locator('#cards .move[aria-label^="フェイント"]');
    const before = await feint.boundingBox();
    await feint.click();
    const after = await feint.boundingBox();
    assert.ok(after.y < before.y - 8, "selected card should rise in hand");
    assert.match(await page.locator("#cardDetail").innerText(), /フェイント/);
    assert.equal(await page.locator("#confirm").isEnabled(), true);

    const scrollTest = await page.locator("#cards").evaluate(el => {
      const max = el.scrollWidth - el.clientWidth;
      el.scrollLeft = max;
      return { max, scrollLeft: el.scrollLeft };
    });
    const ultimate = page.locator('#cards .move[aria-label^="終局宣告"]');
    await ultimate.click();
    assert.match(await page.locator("#cardDetail").innerText(), /勝利/);
    assert.equal(await page.locator("#confirm").isDisabled(), true,
      "seven-energy card cannot be confirmed at one energy");
    const leftAfter = await page.locator("#cards").evaluate(el => el.scrollLeft);
    if (scrollTest.max > 2) assert.ok(leftAfter >= scrollTest.scrollLeft - 3,
      "hand scroll position should not jump back when selecting card");

    const geometry = await page.evaluate(() => {
      const hand = document.querySelector("#cards");
      const selected = document.querySelector("#cards .move.selected");
      const a = hand.getBoundingClientRect();
      const b = selected.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        cardTop: b.top, handTop: a.top, cardBottom: b.bottom, handBottom: a.bottom,
        handScrollable: hand.scrollWidth > hand.clientWidth
      };
    });
    assert.ok(geometry.overflow < 3, "page must not overflow horizontally: " + JSON.stringify(geometry));
    assert.ok(geometry.cardTop >= geometry.handTop - 2, "raised card clipped above the hand");
    assert.ok(geometry.cardBottom <= geometry.handBottom + 2, "card clipped below the hand");

    await page.locator('#basics .move[aria-label^="チャージ"]').click();
    await page.locator("#confirm").click();
    assert.equal(await page.locator("#roundResult").isVisible(), true);
    await page.screenshot({
      path: path.join(screenshots, profile.name + "-round.png"), fullPage: true
    });
    assert.deepEqual(errors, [], "browser errors on " + profile.name);
    console.log("PASS layout " + profile.name + " " + JSON.stringify(geometry));
  } finally {
    await context.close();
  }
}

async function localSecretAndUltimate(browser) {
  const { context, page, errors } = await open(browser, 1194, 834);
  try {
    await page.locator("#localStart").click();
    for (let turn = 0; turn < 6; turn++) {
      await page.locator('#basics .move[aria-label^="チャージ"]').click();
      await page.locator("#confirm").click();
      assert.equal(await page.locator("#handoff").isVisible(), true);
      await page.locator("#handoffProceed").click();
      assert.equal(await page.locator("#cardDetail strong").innerText(), "カードを選ぼう",
        "P1's selected action must not leak to P2's screen");
      await page.locator('#basics .move[aria-label^="チャージ"]').click();
      await page.locator("#confirm").click();
      assert.equal(await page.locator("#roundResult").isVisible(), true);
      await page.locator("#roundResult button").click();
    }
    assert.match(await page.locator("#myEn").innerText(), /7\/7/);
    assert.match(await page.locator("#opEn").innerText(), /7\/7/);
    assert.equal(await page.locator("#opWarning").isVisible(), true);

    await page.locator('#cards .move[aria-label^="終局宣告"]').click();
    assert.equal(await page.locator("#confirm").isEnabled(), true);
    await page.locator("#confirm").click();
    await page.locator("#handoffProceed").click();
    assert.equal(await page.locator("#cardDetail strong").innerText(), "カードを選ぼう");
    await page.locator('#basics .move[aria-label^="通常防御"]').click();
    await page.locator("#confirm").click();
    assert.match(await page.locator("#roundResult h2").innerText(), /PLAYER 1 の勝利/);
    await page.screenshot({
      path: path.join(screenshots, "ipad-ultimate-result.png"), fullPage: true
    });
    assert.deepEqual(errors, [], "browser errors in local match");
    console.log("PASS six charge rounds + ultimate + hidden actions");
  } finally {
    await context.close();
  }
}

async function embeddedSite(browser) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 }, hasTouch: true, deviceScaleFactor: 2,
    locale: "ja-JP"
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.setContent(
      '<style>body{margin:0;background:#16232a}iframe{display:block;width:900px;height:520px;max-width:100%;border:0}</style>' +
      '<iframe id="site" sandbox="allow-scripts allow-same-origin" src="http://127.0.0.1:8782/embed"></iframe>'
    );
    const frame = page.frameLocator("#site");
    await frame.locator("#botStart").click();
    assert.equal(await frame.locator("#cards .move").count(), 11);
    await frame.locator('#cards .move[aria-label^="フェイント"]').click();
    assert.match(await frame.locator("#cardDetail").innerText(), /フェイント/);
    assert.equal(await frame.locator("#confirm").isEnabled(), true);
    await page.screenshot({
      path: path.join(screenshots, "google-sites-like-iframe.png"), fullPage: true
    });
    assert.deepEqual(errors, [], "embedded page errors");
    console.log("PASS Google Sites-like sandboxed iframe");
  } finally {
    await context.close();
  }
}

(async () => {
  await new Promise(resolve => server.listen(8782, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    for (const profile of [
      { name: "ipad-landscape", width: 1194, height: 834 },
      { name: "ipad-compact", width: 1024, height: 768 },
      { name: "small-landscape", width: 900, height: 520 },
      { name: "phone-portrait", width: 390, height: 844 }
    ]) await botLayout(browser, profile);
    await localSecretAndUltimate(browser);
    await embeddedSite(browser);
    console.log("PASS all tablet UI and iframe smoke checks");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
