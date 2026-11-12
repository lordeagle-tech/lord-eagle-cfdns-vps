/**
 * Generate XCASPER MANAGER favicon PNG files from SVG source using canvas rendering.
 * Run: node scripts/gen-favicon.mjs
 * Outputs: public/favicon-16.png and public/favicon-32.png
 */
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, "..", "public");

function buildSvg(size) {
  const rx = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.72);
  const cy = Math.round(size * 0.76);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6e5cff"/>
      <stop offset="100%" stop-color="#0ff4c6"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="#08090d"/>
  <text x="${size / 2}" y="${cy}" text-anchor="middle"
        font-family="sans-serif" font-weight="900" font-size="${fontSize}"
        fill="url(#g)">X</text>
</svg>`;
}

for (const size of [16, 32]) {
  const svg = buildSvg(size);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  const outPath = join(PUBLIC, `favicon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`✓ favicon-${size}.png  (${png.length} B)  →  ${outPath}`);
}

console.log("Done.");
