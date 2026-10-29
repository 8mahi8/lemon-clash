/* WebKit "Google Sites > Insert > Embed > Embed code" approximation:
   inject EXACT generated HTML text as iframe.srcdoc, NOT an iframe src URL.
   This cannot guarantee behavior on Google's real iframe origin or school network. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {webkit} = require("playwright");
const root = path.resolve(__dirname,"..");
async function pastedFrame(browser, html, width, height) {
  const context = await browser.newContext({
    viewport:{width,height},hasTouch:true,isMobile:false,locale:"ja-JP"
  });
  const page = await context.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:8787/");
  await page.evaluate(content => {
    const embed = document.createElement("iframe");
    embed.id="google-sites-embed";
    embed.setAttribute("sandbox","allow-scripts allow-same-origin");
    embed.style.width="100%";
    embed.style.height="100%";
    embed.style.border="0";
    embed.srcdoc=content; // EXACT contents copied from the generated .txt
    document.body.append(embed);
  },html);
  const inner=page.frameLocator("#google-sites-embed");
  await inner.locator("#home").waitFor();
  return {context,page,inner,errors};
}
const http=require("node:http");
const server=http.createServer((_req,res)=>{
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#101d20}</style>');
});
(async()=>{
  await new Promise(ok=>server.listen(8787,"127.0.0.1",ok));
  let browser;
  try{
    browser=await webkit.launch({headless:true});
    const offline=fs.readFileSync(path.join(root,"dist/lemon-clash-embed.txt"),"utf8");
    const online=fs.readFileSync(path.join(root,"dist/lemon-clash-online-lab-embed.txt"),"utf8");
    for(const profile of [{width:1194,height:834},{width:900,height:520}]) {
      const a=await pastedFrame(browser,offline,profile.width,profile.height);
      try{
        await a.inner.locator("#botStart").click();
        assert.equal(await a.inner.locator("#cards .move").count(),15);
        await a.inner.locator('#cards .move[aria-label^="フェイント"]').click();
        assert.match(await a.inner.locator("#cardDetail").innerText(),/フェイント/);
        await a.inner.locator("#confirm").click();
        assert.equal(await a.inner.locator("#roundResult").isVisible(),true);
        assert.deepEqual(a.errors,[]);
      }finally{await a.context.close()}
      const b=await pastedFrame(browser,online,profile.width,profile.height);
      try{
        assert.equal(await b.inner.locator("#onlineHost").isVisible(),true);
        assert.equal(await b.inner.locator("#onlineJoin").isVisible(),true);
        assert.match(await b.inner.locator("#onlineError").innerText(),/部屋を作る/);
        assert.deepEqual(b.errors,[]);
      }finally{await b.context.close()}
      console.log("PASS pasted HTML full code in iframe.srcdoc at "+profile.width+"x"+profile.height);
    }
  }finally{
    if(browser)await browser.close();
    await new Promise(ok=>server.close(ok));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
