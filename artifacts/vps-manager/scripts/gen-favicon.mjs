/**
 * Generate CFDNS Manager favicon PNG files from the Lord Eagle logo SVG.
 * Run from the repo root (needs @resvg/resvg-js): node scripts/gen-favicon.mjs
 * Outputs: public/favicon-*.png, public/apple-touch-icon.png, public/favicon.svg
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, "..", "public");

const source = readFileSync(join(PUBLIC, "lord-eagle-logo.svg"), "utf8");
const iconSvg = source.replace(/rx="56"/, 'rx="0"');

const targets = [
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
  ["favicon-48.png", 48],
  ["favicon-96.png", 96],
  ["favicon-180.png", 180],
  ["favicon-192.png", 192],
  ["favicon-512.png", 512],
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of targets) {
  const resvg = new Resvg(iconSvg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  const outPath = join(PUBLIC, name);
  writeFileSync(outPath, png);
  console.log(`✓ ${name}  ${size}x${size}  (${png.length} B)`);
}

writeFileSync(join(PUBLIC, "favicon.svg"), iconSvg);
console.log("✓ favicon.svg");
console.log("Done.");
