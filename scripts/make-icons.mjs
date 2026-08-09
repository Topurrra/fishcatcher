// Generates placeholder fish icons (16/32/48/128) as PNGs with zero dependencies.
// Pure-JS PNG encoder + 3x3 supersampled vector drawing. Replace art later.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp01(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b), d2 = sign([px, py], b, c), d3 = sign([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function drawIcon(size) {
  const s = size;
  const img = Buffer.alloc(size * size * 4);
  const radius = 0.22 * s;
  const body = { cx: 0.42 * s, cy: 0.52 * s, rx: 0.27 * s, ry: 0.17 * s };
  const tail = [ [0.62 * s, 0.52 * s], [0.86 * s, 0.33 * s], [0.86 * s, 0.71 * s] ];
  const eye = { cx: 0.33 * s, cy: 0.47 * s, r: 0.05 * s };
  const aa = 0.6 * s;

  const covRoundRect = (px, py) => {
    const cx = Math.min(Math.max(px, radius), s - radius);
    const cy = Math.min(Math.max(py, radius), s - radius);
    return clamp01(radius - Math.hypot(px - cx, py - cy));
  };
  const covEllipse = (px, py) => {
    const f = ((px - body.cx) / body.rx) ** 2 + ((py - body.cy) / body.ry) ** 2;
    return f >= 1 ? 0 : clamp01((1 - Math.sqrt(f)) * aa);
  };
  const covCircle = (px, py) => {
    const d = Math.hypot(px - eye.cx, py - eye.cy) / eye.r;
    return d >= 1 ? 0 : clamp01((1 - d) * aa);
  };
  const covTriangle = (px, py) => {
    if (!inTriangle(px, py, ...tail)) return 0;
    const d = Math.min(
      distToSegment(px, py, ...tail[0], ...tail[1]),
      distToSegment(px, py, ...tail[1], ...tail[2]),
      distToSegment(px, py, ...tail[2], ...tail[0])
    );
    return clamp01(d);
  };

  const top = [21, 94, 117], bottom = [11, 32, 51];
  const tailColor = [159, 215, 240], bodyColor = [224, 242, 254], eyeColor = [11, 32, 51];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, ct = 0, cb = 0, ce = 0;
      for (let si = 0; si < 3; si++) {
        for (let sj = 0; sj < 3; sj++) {
          const px = x + (si + 0.5) / 3, py = y + (sj + 0.5) / 3;
          bg += covRoundRect(px, py);
          ct += covTriangle(px, py);
          cb += covEllipse(px, py);
          ce += covCircle(px, py);
        }
      }
      bg /= 9; ct /= 9; cb /= 9; ce /= 9;
      let color = mix(top, bottom, y / size);
      color = mix(color, tailColor, ct);
      color = mix(color, bodyColor, cb);
      color = mix(color, eyeColor, ce);
      const i = (y * size + x) * 4;
      img[i] = Math.round(color[0]);
      img[i + 1] = Math.round(color[1]);
      img[i + 2] = Math.round(color[2]);
      img[i + 3] = Math.round(bg * 255);
    }
  }
  return encodePNG(size, img);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
