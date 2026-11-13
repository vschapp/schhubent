// @ts-nocheck -- imported School Hub source, kept as-is
import { error } from '@/server/appdeploy-sdk';

/**
 * Browser request-origin defence for the platform-managed bearer-token model.
 *
 * This is deliberately NOT a second cookie/session implementation. AppDeploy
 * validates the RS256 bearer token through requireAuth(). This middleware adds
 * Fetch Metadata + Origin/Referer checks to unsafe methods.
 *
 * Optional APP_ALLOWED_ORIGINS is a comma-separated list of exact HTTPS origins
 * for approved same-site frontend deployments (scheme + host + optional port).
 */
type RequestHeaders = Record<string, string | undefined>;

function readHeader(headers: RequestHeaders, name: string): string {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function parseOrigin(value: string): string | null {
  if (!value || value.toLowerCase() === 'null') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const raw = typeof process !== 'undefined' ? process.env.APP_ALLOWED_ORIGINS || '' : '';
  const configured = raw.split(',').map((item) => parseOrigin(item.trim())).filter((item): item is string => Boolean(item));
  // The deployed browser application has a separate origin from the AppDeploy API host.
  // Trust this exact frontend origin; do not widen the allowlist to sibling subdomains.
  
  return new Set(configured);
}

function requestOrigin(event: any, headers: RequestHeaders): string | null {
  const host = readHeader(headers, 'host') || String(event?.requestContext?.domainName || '');
  if (!host) return null;
  const forwardedProto = readHeader(headers, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const protocol = forwardedProto === 'http' && isLocal ? 'http:' : 'https:';
  return parseOrigin(protocol + '//' + host);
}

function forbidden(message: string) {
  return error(message, 403);
}

/**
 * Install this middleware before route authentication middleware. It only
 * evaluates unsafe methods; GET/HEAD/OPTIONS remain unaffected.
 */
export async function validateRequestOrigin(ctx: any) {
  const event = ctx?.event || {};
  const headers = (event.headers || {}) as RequestHeaders;
  const method = String(event?.requestContext?.http?.method || event?.httpMethod || '').toUpperCase();

  if (!method || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return;

  const fetchSite = readHeader(headers, 'sec-fetch-site').toLowerCase();
  if (fetchSite === 'cross-site') return forbidden('Cross-site state-changing requests are not permitted');

  const originHeader = readHeader(headers, 'origin');
  const refererHeader = readHeader(headers, 'referer');
  const origin = originHeader ? parseOrigin(originHeader) : null;
  const refererOrigin = refererHeader ? parseOrigin(refererHeader) : null;

  if (originHeader && !origin) return forbidden('Invalid Origin header');
  if (refererHeader && !refererOrigin) return forbidden('Invalid Referer header');
  if (origin && refererOrigin && origin !== refererOrigin) {
    return forbidden('Origin and Referer do not identify the same origin');
  }

  const sourceOrigin = origin || refererOrigin;
  const targetOrigin = requestOrigin(event, headers);
  const allowedOrigins = configuredOrigins();
  if (targetOrigin) allowedOrigins.add(targetOrigin);

  // If the browser provides a source origin, it must exactly match the request
  // origin or an explicitly configured trusted application origin. Merely
  // sharing a registrable domain (Sec-Fetch-Site: same-site) is not sufficient.
  if (sourceOrigin && !allowedOrigins.has(sourceOrigin)) {
    return forbidden('Request origin is not trusted');
  }

  if (fetchSite === 'same-site' && (!sourceOrigin || !allowedOrigins.has(sourceOrigin))) {
    return forbidden('Same-site request could not be matched to a trusted application origin');
  }

  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return forbidden('Unsupported Fetch Metadata value');
  }

  // Browser mutations must provide Fetch Metadata or a verifiable Origin/
  // Referer. Non-browser integrations without browser metadata may proceed to
  // requireAuth(), which still requires a valid platform-issued bearer token.
  if (!fetchSite && !sourceOrigin) {
    const authorization = readHeader(headers, 'authorization');
    if (!/^Bearer\s+\S+/i.test(authorization)) {
      return forbidden('Browser state-changing requests must include Origin or Referer validation metadata');
    }
  }

  const contentType = readHeader(headers, 'content-type').toLowerCase();
  if (contentType && !contentType.startsWith('application/json') && !contentType.includes('+json') && !contentType.startsWith('multipart/form-data')) {
    return forbidden('Unsupported content type for a state-changing API request');
  }

  return;
}
