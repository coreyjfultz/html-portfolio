// Request details that depend on whether we sit behind a reverse proxy (Caddy, nginx, a host's
// load balancer). X-Forwarded-* headers are only trusted when TRUST_PROXY=1 — otherwise anyone
// could fake their IP (dodging the login rate limit) or the site address used in links.
export const trustProxy = () => process.env.TRUST_PROXY === '1';

const first = v => String(v || '').split(',')[0].trim();

export function clientIp(req) {
  return (trustProxy() && first(req.headers['x-forwarded-for'])) || req.socket?.remoteAddress || '';
}
export function isHttps(req) {
  return process.env.COOKIE_SECURE === '1' || !!req?.socket?.encrypted || (trustProxy() && first(req?.headers['x-forwarded-proto']) === 'https');
}
export function requestHost(req) {
  return (trustProxy() && first(req?.headers['x-forwarded-host'])) || req?.headers?.host || 'localhost';
}
export function requestOrigin(req) {
  return `${isHttps(req) ? 'https' : 'http'}://${requestHost(req)}`;
}
