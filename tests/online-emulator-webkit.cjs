/* Real WebKit x 2 browsers + Firebase Auth/RTDB LOCAL emulators.
   Never reaches any live Firebase database. Requires:
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000
   and locally pinned SDK scripts in artifacts/firebase-sdk.
*/
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { webkit } = require("playwright-core");
const root = path.resolve(__dirname, "..");
const pastedHtml = fs.readFileSync(path.join(root, "dist", "lemon-clash-online-lab-embed.txt"), "utf8");
if (/<script\b[^>]*\bsrc\s*=/i.test(pastedHtml)) throw Error("Paste code cannot require separate JS files");
const sdkDir = path.join(root, "artifacts", "firebase-sdk");
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== "127.0.0.1:9000" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
  throw new Error("Only local Auth + RTDB emulators are authorized for this test");
}
const sdkNames = ["firebase-app-compat.js","firebase-auth-compat.js","firebase-database-compat.js"];
sdkNames.forEach(name => {
  if (!fs.existsSync(path.join(sdkDir,name))) throw Error("SDK fixture absent: "+name);
});
const config = {
  apiKey: "demo-test-web-key",
  authDomain: "demo-lemon-clash.firebaseapp.com",
  databaseURL: "https://demo-lemon-clash-default-rtdb.firebaseio.com",
  projectId: "demo-lemon-clash",
  appId: "1:000000000000:web:0000000000000000000000"
};
const server = http.createServer((req,res) => {
  const url = (req.url||"/").split("?")[0];
  if (url === "/") {
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
    return;
  }
  const target = path.resolve(root, decodeURIComponent(url).replace(/^\/+/, ""));
  if(!target.startsWith(root+path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()){
    res.writeHead(404);res.end();return;
  }
  res.setHeader("Content-Type",target.endsWith(".js")?"text/javascript; charset=utf-8":"text/html; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  fs.createReadStream(target).pipe(res);
});
async function client(browser) {
  const context = await browser.newContext({
    viewport: {width: 1194,height:834},locale:"ja-JP",hasTouch:true,isMobile:false
  });
  const page = await context.newPage();
  const errors=[];
  page.on("pageerror",err=>errors.push(err.message));
  await page.addInitScript(({config})=>{
    window.LEMON_FIREBASE_CONFIG=config;
    window.__LEMON_EMULATOR_ONLY__=true;
  },{config});
  await page.route("https://www.gstatic.com/firebasejs/10.8.0/*",async route=>{
    const name=route.request().url().split("/").pop();
    if(!sdkNames.includes(name))return route.abort("blockedbyclient");
    await route.fulfill({status:200,contentType:"application/javascript",
      body:fs.readFileSync(path.join(sdkDir,name))});
  });
  // Fail closed if the test accidentally calls a real remote database or auth API.
  await page.route(/^https:\/\/(?!www\.gstatic\.com).*?(firebaseio\.com|firebasedatabase\.app|googleapis\.com)/,
    route=>route.abort("blockedbyclient"));
  await page.goto("http://127.0.0.1:8784/");
  // Actual Google Sites-style HTML CODE paste: embed raw complete HTML via srcdoc.
  await page.evaluate(source => {
    const iframe = document.createElement("iframe");
    iframe.id="google-sites-paste";
    iframe.setAttribute("sandbox","allow-scripts allow-same-origin");
    iframe.style.cssText="border:0;width:100vw;height:100vh";
    iframe.srcdoc=source;
    document.body.append(iframe);
  },pastedHtml);
  const iframeHandle = await page.$("#google-sites-paste");
  const embeddedFrame = await iframeHandle.contentFrame();
  await embeddedFrame.locator("#onlineHost").waitFor({state:"visible",timeout:20000});
  return {context,page:embeddedFrame,errors};
}
(async()=>{
  await new Promise(ok=>server.listen(8784,"127.0.0.1",ok));
  let browser;
  const contexts=[];
  try{
    browser=await webkit.launch({headless:true});
    const host=await client(browser),guest=await client(browser);
    contexts.push(host.context,guest.context);
    await host.page.locator("#onlineHost").click();
    await host.page.locator("#lobbyCode").waitFor({state:"visible",timeout:30000});
    const code=(await host.page.locator("#lobbyCode").innerText()).trim();
    assert.match(code,/^[0-9]{6}$/);
    await guest.page.locator("#roomInput").fill(code);
    await guest.page.locator("#onlineJoin").click();
    await Promise.all([
      host.page.locator("#battle").waitFor({state:"visible",timeout:30000}),
      guest.page.locator("#battle").waitFor({state:"visible",timeout:30000})
    ]);
    // A third anonymous player cannot read/join an occupied private room.
    const stranger=await client(browser);
    contexts.push(stranger.context);
    await stranger.page.locator("#roomInput").fill(code);
    await stranger.page.locator("#onlineJoin").click();
    await stranger.page.locator("#onlineError").getByText(/部屋参加失敗/).waitFor({timeout:20000});
    assert.equal(await stranger.page.locator("#battle").isVisible(),false);
    const hostUid=await host.page.evaluate(()=>firebase.auth().currentUser.uid);
    const guestUid=await guest.page.evaluate(()=>firebase.auth().currentUser.uid);
    assert.notEqual(hostUid,guestUid,"browser contexts must use independent anonymous users");
    await host.page.locator('#basics .move[aria-label^="通常攻撃"]').click();
    await host.page.locator("#confirm").click();
    await host.page.locator("#onlineWait").waitFor({state:"visible",timeout:20000});
    const hostCommit=await guest.page.evaluate(async roomCode=>{
      const snapshot=await firebase.database().ref("lemonClashRoomsV1/"+roomCode+"/rounds/1/host").once("value");
      return snapshot.val();
    },code);
    assert.match(hostCommit.hash,/^[0-9a-f]{64}$/);
    assert.equal(hostCommit.reveal,undefined,"must not reveal an action before both commits");
    assert.equal(JSON.stringify(hostCommit).includes("attack"),false);
    // The Rules must reject even the host trying to reveal prematurely.
    let earlyRevealDenied=false;
    try {
      await host.page.evaluate(async ({roomCode,hash})=>{
        await firebase.database().ref("lemonClashRoomsV1/"+roomCode+"/rounds/1/host")
          .set({hash,reveal:{action:"attack",nonce:"ab".repeat(32)}});
      },{roomCode:code,hash:hostCommit.hash});
    }catch(e){earlyRevealDenied=true;}
    assert.equal(earlyRevealDenied,true,"Rules must deny host reveal before opponent commit");
    // A guest cannot impersonate the host commit path.
    let guestWriteDenied=false;
    try{
      await guest.page.evaluate(async roomCode=>{
        await firebase.database().ref("lemonClashRoomsV1/"+roomCode+"/rounds/1/host").set({
          hash:"ff".repeat(32)
        });
      },code);
    }catch(e){guestWriteDenied=true;}
    assert.equal(guestWriteDenied,true,"Rules must reject guest writes to host-owned commits");
    await guest.page.locator('#basics .move[aria-label^="チャージ"]').click();
    await guest.page.locator("#confirm").click();
    await Promise.all([
      host.page.locator("#roundResult").waitFor({state:"visible",timeout:30000}),
      guest.page.locator("#roundResult").waitFor({state:"visible",timeout:30000})
    ]);
    const a=await host.page.locator("#roundResult").innerText();
    const b=await guest.page.locator("#roundResult").innerText();
    assert.match(a,/通常攻撃/);
    assert.match(b,/チャージ/);
    assert.match(await host.page.locator("#opHp").innerText(),/4\/5/);
    assert.match(await guest.page.locator("#myHp").innerText(),/4\/5/);
    await host.page.locator("#roundResult button").click();
    await guest.page.locator("#roundResult button").click();
    assert.equal(await host.page.locator("#confirm").isDisabled(),true);
    // Verify another full simultaneous turn, including synchronized HP and energy.
    await host.page.locator('#basics .move[aria-label^="チャージ"]').click();
    await guest.page.locator('#basics .move[aria-label^="通常攻撃"]').click();
    await host.page.locator("#confirm").click();
    await guest.page.locator("#confirm").click();
    await Promise.all([
      host.page.locator("#roundResult").waitFor({state:"visible",timeout:30000}),
      guest.page.locator("#roundResult").waitFor({state:"visible",timeout:30000})
    ]);
    assert.equal((await host.page.locator("#myHp").innerText()).includes("4/5"),true);
    assert.equal((await guest.page.locator("#opHp").innerText()).includes("4/5"),true);
    // A returning host must resume seat 1P rather than being rejected or taking 2P.
    await host.page.locator("#quit").click();
    await host.page.locator("#roomInput").fill(code);
    await host.page.locator("#onlineJoin").click();
    await host.page.locator("#battle").waitFor({state:"visible",timeout:30000});
    assert.match(await host.page.locator("#myName").innerText(),/1P/);
    assert.match(await guest.page.locator("#myName").innerText(),/2P/);
    // Finish a WHOLE match rather than stopping at a two-turn smoke test.
    // Host alternates charge/attack; guest charges and eventually loses all 5 HP.
    for(let turn=3;turn<=9;turn++){
      await host.page.locator("#roundResult button").click();
      await guest.page.locator("#roundResult button").click();
      const hostMove=turn%2===0 ? "チャージ" : "通常攻撃";
      await host.page.locator('#basics .move[aria-label^="'+hostMove+'"]').click();
      await guest.page.locator('#basics .move[aria-label^="チャージ"]').click();
      await host.page.locator("#confirm").click();
      await guest.page.locator("#confirm").click();
      await Promise.all([
        host.page.locator("#roundResult").waitFor({state:"visible",timeout:30000}),
        guest.page.locator("#roundResult").waitFor({state:"visible",timeout:30000})
      ]);
    }
    assert.match(await host.page.locator("#roundResult h2").innerText(),/勝利/);
    assert.match(await guest.page.locator("#roundResult h2").innerText(),/敗北/);
    assert.equal((await guest.page.locator("#myHp").innerText()).includes("0/5"),true);
    assert.equal((await host.page.locator("#myEn").innerText()).includes("1/7"),true);
    // Existing guest can leave and rejoin the SAME room without taking another seat.
    await guest.page.locator("#quit").click();
    await guest.page.locator("#roomInput").fill(code);
    await guest.page.locator("#onlineJoin").click();
    await guest.page.locator("#battle").waitFor({state:"visible",timeout:30000});
    await guest.page.locator("#roundResult").waitFor({state:"visible",timeout:30000});
    assert.equal((await guest.page.locator("#opHp").innerText()).includes("4/5"),true);
    assert.deepEqual(host.errors,[]);
    assert.deepEqual(guest.errors,[]);
    console.log("PASS two WebKit clients + anonymous Auth + RTDB commit/reveal + state agreement + authz");
  }finally{
    for(const ctx of contexts)await ctx.close();
    if(browser)await browser.close();
    await new Promise(ok=>server.close(ok));
  }
})().catch(e=>{console.error(e);process.exitCode=1});
