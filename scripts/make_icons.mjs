/**
 * Raster icons from public/favicon.svg.
 *
 * usage: node scripts/make_icons.mjs
 *
 * The SVG stays the browser-tab icon, since it follows the reader's colour
 * scheme. Everything that cannot read an SVG gets a raster: Google's search
 * results (a favicon of at least 48 px), iOS home screens (180 px apple touch
 * icon), Android and installed sites (192 and 512 px, via the manifest) and
 * the many clients that still ask for /favicon.ico without reading the page.
 *
 * A raster cannot follow the colour scheme, so the mark sits on a paper
 * square: transparent, the ink mark disappears on a dark tab strip or a dark
 * results page. How much of the square the mark takes depends on who crops
 * it: 60% keeps it inside the circle Android masks the manifest icons to, so
 * those serve as both "any" and "maskable"; iOS only rounds the corners; and
 * at 16 px every pixel of margin is a pixel of mark lost.
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const PAPER = "#fcf9f4";

// The light-scheme mark only: the dark-scheme block would apply to nothing.
const svg = readFileSync("public/favicon.svg", "utf8").replace(/@media[^{]*\{[^}]*\}[^}]*\}/, "");

async function square(size, share) {
  const mark = Math.round(size * share);
  const glyph = await sharp(Buffer.from(svg), { density: 1200 })
    .resize(mark, mark, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{ input: glyph, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An ICO holding PNG images, which every browser since IE 9 reads. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((im) => im.png)]);
}

const outputs = [
  ["public/apple-touch-icon.png", 180, 0.72],
  ["public/icon-192.png", 192, 0.6],
  ["public/icon-512.png", 512, 0.6],
];
for (const [path, size, share] of outputs) {
  writeFileSync(path, await square(size, share));
  console.log(`wrote ${path}`);
}
const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await square(size, 0.9) })));
writeFileSync("public/favicon.ico", ico(small));
console.log("wrote public/favicon.ico (16, 32, 48)");
