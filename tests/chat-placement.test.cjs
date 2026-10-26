"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"online.html"),"utf8");
const release=fs.readFileSync(path.join(root,"release-candidates/LEMON_CLASH_RC8_1_ChatAboveBattle_GoogleSites.txt"),"utf8");

test("room chat does not float over controls",()=>{
  const chat=html.indexOf('id="roomChat"');
  assert.ok(chat>0);
  assert.ok(chat<html.indexOf('id="home"'));
  assert.ok(chat<html.indexOf('id="battle"'));
  assert.ok(html.includes("position:static"));
  assert.ok(!html.includes(".roomChat{position:fixed"));
  assert.ok(html.indexOf('id="chatToggle"')<html.indexOf('id="chatPanel"'));
  assert.ok(html.includes('id="confirm"'));
  assert.ok(html.includes("使い切りカード15枚"));
});

test("release matches full online source with scripts inlined",()=>{
  const scripts=["src/rules.js","src/online-protocol.js","src/firebase-config.js","src/online-app.js"];
  const markers=scripts.map(s=>'<script src="'+s+'"></script>').join("\n  ");
  assert.ok(html.includes(markers));
  const replacement=scripts.map(s=>'<script>\n'+fs.readFileSync(path.join(root,s),"utf8").replace(/<\/script/gi,"<\\/script")+'\n</script>').join("\n  ");
  assert.equal(release,html.replace(markers,replacement));
  assert.equal((release.match(/<script>/g)||[]).length,4);
  assert.ok(!release.includes('<iframe'));
  assert.ok(release.includes("const VERSION = 3"));
});
