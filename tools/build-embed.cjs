#!/usr/bin/env node
/* Build a self-contained HTML for Google Sites -> Embed -> Embed code. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const file = name => fs.readFileSync(path.join(root, name), "utf8");
const html = file("index.html");
const rules = file("src/rules.js");
const app = file("src/app.js");
const marker = '<script src="src/rules.js"></script><script src="src/app.js"></script>';
if (!html.includes(marker)) throw new Error("HTML script marker missing");
const escapeEndTag = code => code.replace(/<\/script/gi, "<\\/script");
const inline = '<script>\n' + escapeEndTag(rules) + '\n</script><script>\n' +
  escapeEndTag(app) + '\n</script>';
const result = html.replace(marker, inline);
const out = path.join(root, "dist", "lemon-clash-embed.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, result, "utf8");
if (result.includes('src="src/')) throw new Error("External script dependency remains");
process.stdout.write("Wrote " + out + " (" + Buffer.byteLength(result, "utf8") + " bytes)\n");
