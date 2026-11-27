// Stored images: job photos, signatures, company logo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './db.js';
import { HttpError } from './resources.js';

const DIRS = { photos: 'photos', signatures: 'signatures', branding: 'branding' };
const SIGS = [
  { type: 'image/jpeg', ext: '.jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: '.png', test: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', ext: '.webp', test: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

/** Accepts base64 or a data: URL. Checks the bytes really are an image (not just the claimed type). */
export function decodeImage(input, { maxBytes = 10 * 1024 * 1024, allowed = ['image/jpeg', 'image/png', 'image/webp'] } = {}) {
  const b64 = String(input || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new HttpError(400, 'No image received');
  if (buf.length > maxBytes) throw new HttpError(413, `Image is larger than ${Math.round(maxBytes / 1048576)} MB`);
  const kind = SIGS.find(s => s.test(buf));
  if (!kind || !allowed.includes(kind.type)) throw new HttpError(400, 'Please upload a JPG, PNG or WebP image');
  return { buf, ...kind };
}

export function saveImage(area, img) {
  const dir = path.join(DATA_DIR, DIRS[area]);
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(14).toString('hex') + img.ext;
  fs.writeFileSync(path.join(dir, key), img.buf, { mode: 0o600 });
  return key;
}

export function imagePath(area, key) {
  const p = path.join(DATA_DIR, DIRS[area], path.basename(String(key || '')));
  if (!key || !fs.existsSync(p)) throw new HttpError(404, 'Image not found');
  return p;
}

export function removeImage(area, key) {
  if (key) fs.rmSync(path.join(DATA_DIR, DIRS[area], path.basename(key)), { force: true });
}

export function sendImage(res, area, key, { cache = 'private, max-age=86400' } = {}) {
  const p = imagePath(area, key);
  const type = SIGS.find(s => p.endsWith(s.ext))?.type || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' });
  fs.createReadStream(p).pipe(res);
}
