#!/usr/bin/env node
/* Google Sites -> Embed -> EMBED CODE: copy the complete generated .txt contents.
   This is HTML CODE PASTING, not a GitHub Pages URL and not an iframe URL.
   Game HTML/CSS/JS are inlined; online matches still require an approved Firebase
   test config, live RTDB access and the Firebase CDN SDK. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const file = name => fs.readFileSync(path.join(root, name), "utf8");
function inlineScript(code) {
  return "<script>\n" + code.replace(/<\/script/gi, "<\\/script") + "\n</script>";
}
function build(source, scripts, name) {
  let html = file(source);
  // Accept both adjacent scripts (offline source) and multiline tags (online source).
  const marker = new RegExp(scripts.map(p =>
    '<script src="' + p.replace(/\./g, '\\.') + '"></script>').join('\\s*'), 'i');
  if (!marker.test(html)) throw new Error("Cannot inline source script marker: " + source);
  html = html.replace(marker, scripts.map(p => inlineScript(file(p))).join("\n  "));

  // No external game source, nested iframe, stylesheet, or GitHub URL required.
  if (/<script\b[^>]*\bsrc\s*=/i.test(html) ||
      /<iframe\b/i.test(html) ||
      /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(html)) {
    throw new Error("Google Sites paste build contains external game assets: " + source);
  }
  if (!/^<!doctype html>/i.test(html.trimStart()) || !/<\/html>\s*$/i.test(html)) {
    throw new Error("Expected a complete HTML document: " + source);
  }
  if (html.includes('src="src/')) throw new Error("Uninlined relative game script");

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const basename = "lemon-clash-" + name;
  // .txt has EXACTLY the same contents as .html; this is the copy/paste handoff.
  for (const extension of [".html", ".txt"]) {
    const out = path.join(dist, basename + extension);
    fs.writeFileSync(out, html, "utf8");
    process.stdout.write("Google Sites EMBED CODE: " + out +
      " (" + Buffer.byteLength(html, "utf8") + " bytes)\n");
  }
}
build("index.html",
  ["src/rules.js", "src/app.js"], "embed");
build("online.html",
  ["src/rules.js", "src/online-protocol.js", "src/firebase-config.js", "src/online-app.js"],
  "online-lab-embed");
