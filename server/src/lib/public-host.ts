import type { IncomingHttpHeaders } from 'node:http';

/**
 * The Cloudflare Pages front door sits in front of this process. Browsers speak to
 * pages.dev; the worker forwards the request here and tells us the public host.
 * An arbitrary X-Forwarded-Host is not trusted — only the configured PUBLIC_BASE_URL.
 */
export interface ProxyTrust {
  trustProxy: boolean;
  publicBaseUrl: string | null;
}

export const headerFirst = (value: string | string[] | undefined): string => {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').split(',')[0].trim();
};

const baseUrl = (publicBaseUrl: string | null): URL | null => {
  if (!publicBaseUrl) return null;
  try { return new URL(publicBaseUrl); } catch { return null; }
};

/**
 * Host the browser used. When trust proxy is on and X-Forwarded-Host is exactly the
 * PUBLIC_BASE_URL host, that value is the public host. Anything else stays on the
 * Host header the connection arrived with (the upstream name).
 */
export function browserHost(headers: IncomingHttpHeaders, proxy: ProxyTrust): string {
  const direct = headerFirst(headers.host);
  if (!proxy.trustProxy) return direct;
  const base = baseUrl(proxy.publicBaseUrl);
  if (!base) return direct;
  const forwarded = headerFirst(headers['x-forwarded-host']);
  if (forwarded.toLowerCase() === base.host.toLowerCase()) return forwarded;
  return direct;
}

/**
 * Browser WebSocket origins that may connect.
 * Missing Origin is allowed (non-browser clients and tests).
 * Otherwise the origin must be this process's Host, or the configured front door.
 */
export function socketOriginAllowed(origin: string | undefined, headers: IncomingHttpHeaders, proxy: ProxyTrust): boolean {
  if (!origin) return true;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const originHost = url.host.toLowerCase();
  const host = headerFirst(headers.host).toLowerCase();
  if (host && originHost === host) return true;
  const base = baseUrl(proxy.publicBaseUrl);
  if (!base) return false;
  if (url.origin === base.origin) return true;
  // Trust X-Forwarded-Host only when it is the configured front door and the browser origin matches it.
  if (proxy.trustProxy) {
    const forwarded = headerFirst(headers['x-forwarded-host']).toLowerCase();
    if (forwarded && forwarded === base.host.toLowerCase() && originHost === forwarded) return true;
  }
  return false;
}
