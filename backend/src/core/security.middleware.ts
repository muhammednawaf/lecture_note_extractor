import { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

// ============================================================================
// 1. SECURITY HEADERS (Protection against XSS, Clickjacking, MIME-sniffing)
// ============================================================================

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // Remove Express identification header
  res.removeHeader('X-Powered-By');

  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Defend against clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Cross-Site Scripting filter
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer information control
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (Defense against unauthorized sensor access)
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');

  // Cross-Origin Isolation & Opener Policy
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http: https:; frame-ancestors 'none';"
  );

  // Enforce HTTPS HSTS when in production or HTTPS protocol
  if (process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
}

// ============================================================================
// 2. RATE LIMITING (Protection against Bots, DoS, and Resource Exhaustion)
// ============================================================================

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  prefix?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Determine client identifier (IP address)
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown-ip';

    const key = `${options.prefix || 'global'}:${clientIp}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      rateLimitStore.set(key, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, options.maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', options.maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > options.maxRequests) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: options.message || 'Too many requests. Please try again later.',
        retryAfterSeconds: resetSeconds,
      });
    }

    next();
  };
}

// Global API rate limiter (100 requests per 15 min per IP)
export const globalApiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '200', 10),
  prefix: 'api',
  message: 'API rate limit exceeded. Please wait a few minutes.',
});

// Stricter rate limiter for heavy processing/extraction endpoints (20 per 15 min per IP)
export const heavyComputeRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: parseInt(process.env.RATE_LIMIT_HEAVY_MAX || '30', 10),
  prefix: 'heavy',
  message: 'Too many processing requests triggered. Please wait before starting another extraction.',
});

// ============================================================================
// 3. INPUT VALIDATION & SANITIZATION (Protection against Injection & Path Traversal)
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that route parameter :id or :pageId is a valid UUID,
 * preventing Path Traversal ('../../') and query parameter injection.
 */
export function validateUuidParam(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (!value || !UUID_REGEX.test(value)) {
      return res.status(400).json({
        error: `Invalid resource identifier format for '${paramName}'. Must be a valid UUID.`,
      });
    }
    next();
  };
}

/**
 * Validates YouTube lecture URLs and defends against SSRF (Server-Side Request Forgery).
 * Strictly requires youtube.com or youtu.be domain and a valid 11-char video ID.
 * Blocks private IP ranges, localhost, and internal cloud metadata endpoints.
 */
export function validateYouTubeUrlInput(url: string): { isValid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'YouTube URL must be a non-empty string' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { isValid: false, error: 'Malformed URL structure' };
  }

  // Enforce HTTP / HTTPS protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isValid: false, error: 'URL must use http or https protocol' };
  }

  // Reject non-standard ports to defend against SSRF port scanning
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { isValid: false, error: 'Non-standard port numbers are not permitted' };
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'User credentials in URL are prohibited' };
  }

  // SSRF defense: block localhost, private subnets, cloud metadata
  const host = parsed.hostname.toLowerCase();
  const BLOCKED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS/DigitalOcean metadata
    'metadata.google.internal',
  ];

  if (BLOCKED_HOSTS.includes(host) || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.')) {
    return { isValid: false, error: 'Access to private or internal addresses is strictly prohibited (SSRF protection)' };
  }

  // Allowed domain check
  const ALLOWED_DOMAINS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
  if (!ALLOWED_DOMAINS.includes(host)) {
    return { isValid: false, error: `Invalid YouTube host '${host}'. Must be youtube.com or youtu.be` };
  }

  // Video ID check
  let videoId: string | null = null;
  if (host === 'youtu.be') {
    videoId = parsed.pathname.slice(1).split('&')[0];
  } else {
    videoId = parsed.searchParams.get('v');
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { isValid: false, error: 'Invalid or missing YouTube 11-character video ID' };
  }

  return { isValid: true };
}

/**
 * Recursively sanitizes JSON request payloads to defend against MongoDB NoSQL operator injection.
 * Strips any property names starting with '$' or containing '.'
 */
export function sanitizeNoSqlPayload(req: Request, _res: Response, next: NextFunction) {
  const sanitize = (obj: any): any => {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      const clean: any = {};
      for (const [key, val] of Object.entries(obj)) {
        // Defend against NoSQL injection ($where, $gt) and Prototype Pollution (__proto__, constructor)
        if (
          !key.startsWith('$') &&
          !key.includes('.') &&
          key !== '__proto__' &&
          key !== 'constructor' &&
          key !== 'prototype'
        ) {
          clean[key] = sanitize(val);
        }
      }
      return clean;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query) as any;
  }
  next();
}

/**
 * Sanitizes output filenames to prevent Content-Disposition Header Injection / CRLF injection.
 */
export function sanitizeHeaderFilename(filename: string): string {
  return filename
    .replace(/[\r\n\0\t]/g, '')
    .replace(/[^\w\s.-]/gi, '_')
    .trim()
    .slice(0, 80);
}

