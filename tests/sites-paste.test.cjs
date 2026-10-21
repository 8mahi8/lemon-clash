/* Regression gate for the ACTUAL Google Sites "Embed > Embed code" handoff.
   The input is complete HTML text, not a GitHub Pages link or iframe URL. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function build() {
  execFileSync(process.execPath, [path.join(root, "tools", "build-embed.cjs")],
    { cwd: root, stdio: "pipe", timeout: 15000 });
}
function read(name) { return fs.readFileSync(path.join(root, "dist", name), "utf8"); }

test("offline and online Google Sites paste texts match complete standalone HTML", () => {
  build();
  for (const name of ["lemon-clash-embed", "lemon-clash-online-lab-embed"]) {
    const html = read(name + ".html");
    const text = read(name + ".txt");
    assert.equal(text, html, "pasted .txt must be byte-identical to source HTML");
    assert.match(text, /^\s*<!doctype html>/i);
    assert.match(text, /<\/html>\s*$/i);
    assert.doesNotMatch(text, /<iframe\b/i, "no iframe URL is pasted");
    assert.doesNotMatch(text, /<script\b[^>]*\bsrc\s*=/i, "JS code must be inlined");
    assert.doesNotMatch(text, /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
    assert.doesNotMatch(text, /https:\/\/8mahi8\.github\.io\//i,
      "pasting should not depend on GitHub Pages");
    assert.match(text, /<style>[\s\S]*<\/style>/);
    const scripts = [...text.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    assert.equal(scripts.length, name.includes("online") ? 4 : 2);
    scripts.forEach((source, i) => new vm.Script(source, {filename:name+"#script"+i}));
  }
});
test("online embed includes the shared RTDB connection and isolated room namespace", () => {
  const html = read("lemon-clash-online-lab-embed.txt");
  assert.ok(html.includes('mode: "shared-rtdb"'));
  assert.ok(html.includes("mygame-df915-default-rtdb.firebaseio.com"));
  assert.ok(html.includes("lemonClashRoomsV1"));
  assert.equal(html.includes("shokokuRooms1v1"),false);
});
