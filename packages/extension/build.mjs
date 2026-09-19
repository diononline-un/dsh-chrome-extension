import * as esbuild from "esbuild";
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const outdir = path.join(root, "dist");
const watch = process.argv.includes("--watch");

const entryPoints = {
  background: "src/background/index.ts",
  "content-dom": "src/content/dom.ts",
  "content-indicator": "src/content/indicator.ts",
  sidepanel: "src/sidepanel/main.ts",
  options: "src/options/main.ts",
  offscreen: "src/offscreen/main.ts",
};

const common = {
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  legalComments: "none",
};

async function copyStatic() {
  await cp(path.join(root, "manifest.json"), path.join(outdir, "manifest.json"));
  for (const name of ["sidepanel.html", "options.html", "offscreen.html"]) {
    await cp(path.join(root, "static", name), path.join(outdir, name));
  }
  if (existsSync(path.join(root, "static/icons"))) {
    await cp(path.join(root, "static/icons"), path.join(outdir, "icons"), { recursive: true });
  }
  // vendored gif encoder for the offscreen document
  if (existsSync(path.join(root, "vendor/gif.worker.js"))) {
    await cp(path.join(root, "vendor/gif.worker.js"), path.join(outdir, "gif.worker.js"));
  }
}

async function main() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const ctx = await esbuild.context({
    ...common,
    entryPoints: Object.fromEntries(
      Object.entries(entryPoints).map(([k, v]) => [k, path.join(root, v)]),
    ),
    outdir,
  });

  await ctx.rebuild();
  await copyStatic();

  if (watch) {
    await ctx.watch();
    console.log("watching…");
  } else {
    await ctx.dispose();
    console.log("built ->", path.relative(process.cwd(), outdir));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
