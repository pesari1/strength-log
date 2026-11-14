// Draws the app icon (a barbell) and writes the PNG files. Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [0x16, 0x18, 0x1d];
const FG = [0xff, 0x8a, 0x3d];

// Rounded rectangles in 0..1 space: [x0, y0, x1, y1, radius]
const SHAPES = [
  [0.07, 0.474, 0.93, 0.526, 0.02], // bar
  [0.245, 0.235, 0.335, 0.765, 0.035], // big plates
  [0.665, 0.235, 0.755, 0.765, 0.035],
  [0.165, 0.33, 0.23, 0.67, 0.03], // small plates
  [0.77, 0.33, 0.835, 0.67, 0.03],
  [0.335, 0.435, 0.37, 0.565, 0.012], // collars
  [0.63, 0.435, 0.665, 0.565, 0.012],
];

function inRoundRect(x, y, [x0, y0, x1, y1, r]) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function draw(size, scale = 1) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let hits = 0;
      for (let sj = 0; sj < SS; sj++)
        for (let si = 0; si < SS; si++) {
          const x = 0.5 + ((i + (si + 0.5) / SS) / size - 0.5) / scale;
          const y = 0.5 + ((j + (sj + 0.5) / SS) / size - 0.5) / scale;
          if (SHAPES.some((s) => inRoundRect(x, y, s))) hits++;
        }
      const a = hits / (SS * SS);
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
      px[o + 3] = 255;
    }
  }
  return png(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(OUT, 'icon-180.png'), draw(180));
writeFileSync(join(OUT, 'icon-192.png'), draw(192));
writeFileSync(join(OUT, 'icon-512.png'), draw(512));
writeFileSync(join(OUT, 'icon-maskable-512.png'), draw(512, 0.8));
console.log('Icons written to', OUT);
