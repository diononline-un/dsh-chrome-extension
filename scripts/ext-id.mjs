#!/usr/bin/env node
/** Derive the Chrome extension id from the `key` field in the extension manifest. */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));

export function extensionId() {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "packages/extension/manifest.json"), "utf8"),
  );
  if (!manifest.key) throw new Error("manifest.json has no `key` field");
  const der = Buffer.from(manifest.key, "base64");
  const hash = crypto.createHash("sha256").update(der).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return id;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(extensionId());
}
