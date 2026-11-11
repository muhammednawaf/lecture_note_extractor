import crypto from 'crypto';

export interface JwtPayload {
  userId: string;
  email: string;
  exp: number;
  iat: number;
}

// Fallback secret for local development; in production JWT_SECRET is strictly required
const DEFAULT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('CRITICAL SECURITY: JWT_SECRET environment variable MUST be defined in production!'); })()
    : 'video2pdf_jwt_super_secure_development_secret_2026'
);

function base64UrlEncode(str: string | Buffer): string {
  const buf = typeof str === 'string' ? Buffer.from(str) : str;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export class JwtService {
  /**
   * Generates a signed JWT with HS256 (HMAC-SHA256).
   * Valid for 7 days by default.
   */
  static sign(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresInDays = 7): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInDays * 24 * 60 * 60;

    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp,
    };

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

    const signature = crypto
      .createHmac('sha256', DEFAULT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();

    const encodedSignature = base64UrlEncode(signature);

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Verifies and decodes a JWT using constant-time comparison to prevent timing attacks.
   * Checks signature and expiration timestamp.
   */
  static verify(token: string): JwtPayload {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token format');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT segments');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', DEFAULT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();

    const actualSignature = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    if (expectedSignature.length !== actualSignature.length) {
      throw new Error('Invalid token signature length');
    }

    const isValidSig = crypto.timingSafeEqual(expectedSignature, actualSignature);
    if (!isValidSig) {
      throw new Error('Invalid token signature');
    }

    // Decode and parse payload
    const decodedPayloadStr = base64UrlDecode(encodedPayload);
    const payload: JwtPayload = JSON.parse(decodedPayloadStr);

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('Token has expired');
    }

    return payload;
  }
}
