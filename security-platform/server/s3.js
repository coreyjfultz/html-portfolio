// A small client for S3-compatible storage (Backblaze B2, Amazon S3, Cloudflare R2, Wasabi,
// MinIO…), used for off-site backups. Only what backups need: upload (with Object Lock),
// list, download. Requests are signed with AWS Signature Version 4.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex');
const PART = Number(process.env.S3_PART_BYTES) || 16 * 1024 * 1024; // multipart part size (min 5 MB except the last)
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** AWS Signature V4 for one request. Returns the headers to send (incl. Authorization). */
export function signV4({ method, host, path, query = {}, headers = {}, payloadHash = EMPTY_SHA, region, accessKeyId, secretAccessKey, service = 's3', date = new Date() }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(h).sort();
  const canonQuery = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k] ?? '')}`).join('&');
  const canonPath = path.split('/').map(enc).join('/');
  const canonical = [method, canonPath, canonQuery, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  delete h.host;
  return h;
}

/** Region from a well-known endpoint name, e.g. s3.us-west-004.backblazeb2.com → us-west-004. */
export function regionFromEndpoint(endpoint) {
  const host = (() => { try { return new URL(endpoint).hostname; } catch { return ''; } })();
  if (host.endsWith('.r2.cloudflarestorage.com')) return 'auto';
  const m = host.match(/^s3[.-]([a-z0-9-]+)\.(?:backblazeb2|amazonaws|wasabisys)\.com$/);
  return m ? m[1] : 'us-east-1';
}

const xmlAll = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
const xmlOne = (xml, tag) => xmlAll(xml, tag)[0];
const unxml = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class S3Error extends Error {
  constructor(status, code, message) { super(`${code || `HTTP ${status}`}: ${message || 'request failed'}`); this.status = status; this.code = code; }
}

export function s3Client({ endpoint, region, bucket, accessKeyId, secretAccessKey, timeoutMs = 120000 }) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('Off-site storage is missing its address, bucket or keys');
  const base = new URL(endpoint.replace(/\/+$/, ''));
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('The storage address must start with https://');
  region ||= regionFromEndpoint(endpoint);
  const prefixPath = base.pathname.replace(/\/+$/, '');
  const objPath = key => `${prefixPath}/${bucket}${key ? `/${key}` : ''}`;

  async function request(method, key, { query = {}, headers = {}, body, payloadHash, raw = false } = {}) {
    const path = objPath(key);
    const hash = payloadHash || (body && !(body instanceof Readable) ? sha256(body) : EMPTY_SHA);
    const signed = signV4({ method, host: base.host, path, query, headers, payloadHash: hash, region, accessKeyId, secretAccessKey });
    const qs = Object.keys(query).length ? `?${Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k] ?? '')}`).join('&')}` : '';
    const res = await fetch(`${base.origin}${path.split('/').map(enc).join('/')}${qs}`, {
      method, headers: signed, body, ...(body instanceof Readable ? { duplex: 'half' } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new S3Error(res.status, unxml(xmlOne(text, 'Code')), unxml(xmlOne(text, 'Message')) || text.slice(0, 200));
    }
    return raw ? res : res.text();
  }
  const lockHeaders = lock => lock?.until ? { 'x-amz-object-lock-mode': lock.mode === 'governance' ? 'GOVERNANCE' : 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': lock.until.toISOString().replace(/\.\d{3}Z$/, 'Z') } : {};
  const md5 = b => crypto.createHash('md5').update(b).digest('base64');

  return {
    region,
    async putObject(key, body, { lock, contentType = 'application/octet-stream' } = {}) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      await request('PUT', key, { body: buf, headers: { 'content-type': contentType, 'content-md5': md5(buf), 'content-length': buf.length, ...lockHeaders(lock) } });
    },
    /** Upload a local file (any size). Object Lock retention is set when `lock.until` is given. */
    async uploadFile(key, file, { lock } = {}) {
      const size = fs.statSync(file).size;
      if (size <= PART) return this.putObject(key, fs.readFileSync(file), { lock });
      const created = await request('POST', key, { query: { uploads: '' }, headers: { 'content-type': 'application/octet-stream', ...lockHeaders(lock) } });
      const uploadId = unxml(xmlOne(created, 'UploadId'));
      const parts = [];
      const fd = fs.openSync(file, 'r');
      try {
        for (let n = 1, pos = 0; pos < size; n++, pos += PART) {
          const buf = Buffer.alloc(Math.min(PART, size - pos));
          fs.readSync(fd, buf, 0, buf.length, pos);
          const res = await request('PUT', key, { query: { partNumber: String(n), uploadId }, body: buf, headers: { 'content-md5': md5(buf), 'content-length': buf.length }, raw: true });
          parts.push({ n, etag: res.headers.get('etag') });
        }
        const xml = `<CompleteMultipartUpload>${parts.map(p => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
        const done = await request('POST', key, { query: { uploadId }, body: Buffer.from(xml), headers: { 'content-type': 'application/xml' } });
        if (/<Error>/.test(done)) throw new S3Error(200, unxml(xmlOne(done, 'Code')), unxml(xmlOne(done, 'Message')));
        // Some services ignore lock settings on multi-part uploads; set the retention explicitly.
        if (lock?.until) await this.setRetention(key, lock).catch(e => { throw new Error(`Uploaded, but couldn’t lock it against deletion (${e.message}). Turn on Object Lock for the bucket.`); });
      } catch (e) {
        await request('DELETE', key, { query: { uploadId } }).catch(() => {}); // best effort (may not be allowed)
        throw e;
      } finally { fs.closeSync(fd); }
    },
    async setRetention(key, lock) {
      const xml = Buffer.from(`<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>${lock.mode === 'governance' ? 'GOVERNANCE' : 'COMPLIANCE'}</Mode><RetainUntilDate>${lock.until.toISOString().replace(/\.\d{3}Z$/, 'Z')}</RetainUntilDate></Retention>`);
      await request('PUT', key, { query: { retention: '' }, body: xml, headers: { 'content-type': 'application/xml', 'content-md5': md5(xml), 'content-length': xml.length } });
    },
    async list(prefix = '') {
      const out = [];
      let token;
      do {
        const xml = await request('GET', '', { query: { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) } });
        for (const c of xmlAll(xml, 'Contents')) out.push({ key: unxml(xmlOne(c, 'Key')), size: Number(xmlOne(c, 'Size')), modified: xmlOne(c, 'LastModified') });
        token = xmlOne(xml, 'IsTruncated') === 'true' ? unxml(xmlOne(xml, 'NextContinuationToken')) : null;
      } while (token);
      return out;
    },
    async getText(key) { return request('GET', key); },
    async downloadFile(key, dest) {
      const res = await request('GET', key, { raw: true });
      const tmp = `${dest}.partial`;
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { mode: 0o600 }));
      fs.renameSync(tmp, dest);
    },
  };
}
