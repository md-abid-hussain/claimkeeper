// Renders plugin/.claude-plugin/icon.png (1024x1024) with no dependencies:
// shapes are signed distance functions, anti-aliased per pixel, encoded with node:zlib.
// Motif: a document whose lines are "claims", with a check badge for "consistent".
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../plugin/.claude-plugin/icon.png");

// ---------- signed distance functions (negative inside) ----------
const roundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const segment = (px, py, ax, ay, bx, by, r) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};
const coverage = (d, soft = 1) => Math.max(0, Math.min(1, 0.5 - d / soft));

// ---------- colors ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG_A = hex("#4F46E5"); // indigo
const BG_B = hex("#7C3AED"); // violet
const WHITE = hex("#FFFFFF");
const LINE_STRONG = hex("#4F46E5");
const LINE_SOFT = hex("#C7D2FE");
const BADGE = hex("#10B981"); // emerald

// ---------- scene ----------
const lines = [
  { y: 318, x1: 300, x2: 590, color: LINE_STRONG },
  { y: 408, x1: 300, x2: 640, color: LINE_SOFT },
  { y: 498, x1: 300, x2: 560, color: LINE_SOFT },
  { y: 588, x1: 300, x2: 470, color: LINE_SOFT },
];

function shade(x, y) {
  // background tile with diagonal gradient
  const bgA = coverage(roundRect(x, y, 512, 512, 512, 512, 230));
  if (bgA === 0) return [0, 0, 0, 0];
  let c = mix(BG_A, BG_B, Math.min(1, Math.max(0, (x + y) / (2 * SIZE))));

  // soft shadow under the card
  const shadow = coverage(roundRect(x, y - 22, 470, 470, 262, 322, 56), 46) * 0.28;
  c = mix(c, [20, 14, 60], shadow);

  // document card
  c = mix(c, WHITE, coverage(roundRect(x, y, 470, 470, 262, 322, 56)));

  // text lines (the claims)
  for (const l of lines) c = mix(c, l.color, coverage(segment(x, y, l.x1, l.y, l.x2, l.y, 21)));

  // check badge: white ring, emerald disc, white check
  c = mix(c, WHITE, coverage(circle(x, y, 712, 712, 196)));
  c = mix(c, BADGE, coverage(circle(x, y, 712, 712, 170)));
  const check = Math.min(segment(x, y, 622, 716, 684, 778, 26), segment(x, y, 684, 778, 806, 640, 26));
  c = mix(c, WHITE, coverage(check));

  return [...c.map((v) => Math.round(v)), Math.round(bgA * 255)];
}

// ---------- PNG encoding ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const px = shade(x + 0.5, y + 0.5);
    raw.set(px, y * (SIZE * 4 + 1) + 1 + x * 4);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`);
