#!/usr/bin/env node
/* Build self-contained offline and ONLINE lab HTML for Google Sites -> Embed code.
   A configured Firebase project remains required for online; Firebase SDKs are
   loaded from gstatic only after a user explicitly creates/joins a room. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const file = name => fs.readFileSync(path.join(root, name), "utf8");
function inlineScript(code) {
  return "<script>\n" + code.replace(/<\/script/gi, "<\\/script") + "\n</script>";
}
function build(name, scripts, outName) {
  let html = file(name);
  const marker = scripts.map(p => '<script src="' + p + '"></script>').join("\n  ");
  if (!html.includes(marker)) {
    throw new Error("HTML script marker missing: " + name);
  }
  const combined = scripts.map(p => inlineScript(file(p))).join("\n  ");
  html = html.replace(marker, combined);
  if (/<script\s+src="src\//.test(html)) {
    throw new Error("External gameplay source dependency remains in " + name);
  }
  const out = path.join(root, "dist", outName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, "utf8");
  process.stdout.write("Wrote " + out + " (" + Buffer.byteLength(html) + " bytes)\n");
}
build("index.html",
  ["src/rules.js", "src/app.js"], "lemon-clash-embed.html");
build("online.html",
  ["src/rules.js", "src/online-protocol.js", "src/firebase-config.js", "src/online-app.js"],
  "lemon-clash-online-lab-embed.html");
