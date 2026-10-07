// Genera íconos PNG sin dependencias: fondo verde con un anillo blanco.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function png(size, ringScale, rounded) {
  const bg = [0x0f, 0x76, 0x6e];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const rOut = size * 0.3 * ringScale;
  const rIn = size * 0.22 * ringScale;
  const radius = size * 0.19;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const ring = d <= rOut && d >= rIn;
      let alpha = 255;
      if (rounded) {
        const dx = Math.max(Math.abs(x + 0.5 - c) - (c - radius), 0);
        const dy = Math.max(Math.abs(y + 0.5 - c) - (c - radius), 0);
        if (Math.hypot(dx, dy) > radius) alpha = 0;
      }
      const o = row + 1 + x * 4;
      const col = ring ? [255, 255, 255] : bg;
      raw[o] = col[0];
      raw[o + 1] = col[1];
      raw[o + 2] = col[2];
      raw[o + 3] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', png(192, 1, true));
writeFileSync('public/icon-512.png', png(512, 1, true));
// Maskable: sin esquinas redondeadas y contenido dentro de la zona segura (80 %).
writeFileSync('public/icon-maskable-512.png', png(512, 0.8, false));
console.log('Íconos generados en public/');
