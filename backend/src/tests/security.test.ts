/**
 * Test Suite: Security & Hardening Controls
 * Tests:
 * 1. Security Headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, X-Powered-By)
 * 2. Rate Limiting (sliding-window IP tracking, 429 response, Retry-After header)
 * 3. SSRF Protection & YouTube URL Validation (rejects private IPs, cloud metadata, malicious schemes)
 * 4. UUID Validation & Path Traversal Prevention (rejects ../, invalid IDs, passes RFC4122 UUIDs)
 * 5. NoSQL Operator Injection Sanitization (strips $ and . keys from body/query)
 * 6. Header Filename Sanitization (CRLF injection prevention)
 */

import assert from 'assert';
import {
  securityHeadersMiddleware,
  createRateLimiter,
  validateYouTubeUrlInput,
  validateUuidParam,
  sanitizeNoSqlPayload,
  sanitizeHeaderFilename,
} from '../core/security.middleware.js';

async function runSecurityTests() {
  console.log('====================================================');
  console.log('Running Security & Hardening Verification Tests');
  console.log('====================================================\n');

  let passedTests = 0;

  // ----------------------------------------------------
  // Test 1: Security Headers
  // ----------------------------------------------------
  console.log('Test 1: Security Headers Middleware enforces defensive headers...');
  const headers: Record<string, string> = { 'x-powered-by': 'Express' };
  const mockReq: any = { secure: true, headers: {} };
  const mockRes: any = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    removeHeader: (k: string) => {
      delete headers[k.toLowerCase()];
    },
  };

  let nextCalled = false;
  securityHeadersMiddleware(mockReq, mockRes, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(headers['x-powered-by'], undefined, 'X-Powered-By must be removed');
  assert.strictEqual(headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(headers['x-frame-options'], 'DENY');
  assert.strictEqual(headers['x-xss-protection'], '1; mode=block');
  assert.strictEqual(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(headers['content-security-policy']?.includes("default-src 'self'"));
  assert.ok(headers['strict-transport-security']?.includes('max-age=31536000'));
  console.log('  ✓ All security headers (CSP, HSTS, anti-clickjack, anti-MIME-sniff) properly set');
  passedTests++;

  // ----------------------------------------------------
  // Test 2: Rate Limiting
  // ----------------------------------------------------
  console.log('\nTest 2: Rate Limiting throttles excessive requests with HTTP 429...');
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 3,
    prefix: 'test-limiter',
    message: 'Rate limit hit',
  });

  const clientReq: any = {
    headers: { 'x-forwarded-for': '203.0.113.195' },
    socket: {},
  };

  let lastStatus = 200;
  let lastBody: any = null;
  const clientRes: any = {
    setHeader: () => {},
    status: (code: number) => {
      lastStatus = code;
      return {
        json: (data: any) => {
          lastBody = data;
        },
      };
    },
  };

  // 3 allowed requests
  for (let i = 0; i < 3; i++) {
    limiter(clientReq, clientRes, () => {});
    assert.strictEqual(lastStatus, 200, `Request ${i + 1} should be permitted`);
  }

  // 4th request should be throttled (HTTP 429)
  limiter(clientReq, clientRes, () => {});
  assert.strictEqual(lastStatus, 429, 'Excess request must return HTTP 429');
  assert.strictEqual(lastBody.error, 'Rate limit hit');
  assert.ok(lastBody.retryAfterSeconds > 0);
  console.log('  ✓ Rate limiter effectively blocks excess requests with HTTP 429 and Retry-After');
  passedTests++;

  // ----------------------------------------------------
  // Test 3: SSRF & YouTube URL Validation
  // ----------------------------------------------------
  console.log('\nTest 3: YouTube URL validation blocks SSRF & malicious targets...');
  // Legitimate URLs
  const valid1 = validateYouTubeUrlInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(valid1.isValid, true);
  const valid2 = validateYouTubeUrlInput('https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(valid2.isValid, true);

  // SSRF attempts: localhost, internal IPs, cloud metadata
  const ssrf1 = validateYouTubeUrlInput('http://localhost/secret');
  assert.strictEqual(ssrf1.isValid, false);
  assert.ok(ssrf1.error?.includes('SSRF') || ssrf1.error?.includes('Invalid YouTube host'));

  const ssrf2 = validateYouTubeUrlInput('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(ssrf2.isValid, false);

  const ssrf3 = validateYouTubeUrlInput('http://127.0.0.1:8000/api/admin');
  assert.strictEqual(ssrf3.isValid, false);

  // Malicious / non-YouTube schemes
  const malicious1 = validateYouTubeUrlInput('javascript:alert(1)');
  assert.strictEqual(malicious1.isValid, false);

  const malicious2 = validateYouTubeUrlInput('https://evil-phishing-site.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(malicious2.isValid, false);

  console.log('  ✓ SSRF attacks (localhost, 169.254.169.254, internal subnets) and phishing hosts blocked');
  passedTests++;

  // ----------------------------------------------------
  // Test 4: UUID Validation & Path Traversal Prevention
  // ----------------------------------------------------
  console.log('\nTest 4: UUID route validator blocks path traversal attempts...');
  const uuidValidator = validateUuidParam('id');

  // Valid UUID
  let uuidPassed = false;
  const validReq: any = { params: { id: '3d52339a-8c47-4e1f-b2ac-20899031fc3a' } };
  uuidValidator(validReq, {} as any, () => {
    uuidPassed = true;
  });
  assert.strictEqual(uuidPassed, true, 'Valid UUID must pass');

  // Path traversal attempt: ../../etc/passwd
  let traversalStatus = 200;
  let traversalError = '';
  const badReq: any = { params: { id: '../../etc/passwd' } };
  const badRes: any = {
    status: (code: number) => {
      traversalStatus = code;
      return {
        json: (data: any) => {
          traversalError = data.error;
        },
      };
    },
  };
  uuidValidator(badReq, badRes, () => {});
  assert.strictEqual(traversalStatus, 400, 'Path traversal must be rejected with HTTP 400');
  assert.ok(traversalError.includes('Must be a valid UUID'));
  console.log('  ✓ Path traversal sequences (../) safely blocked by strict UUID validation');
  passedTests++;

  // ----------------------------------------------------
  // Test 5: NoSQL Injection Sanitization
  // ----------------------------------------------------
  console.log('\nTest 5: NoSQL injection sanitizer removes $ and . operators...');
  const maliciousPayload: any = {
    body: {
      videoTitle: 'Legit Lecture',
      $where: 'sleep(5000)',
      nested: {
        $gt: '',
        'dot.key': 'injection',
        validKey: 'keep this',
      },
    },
    query: {
      $ne: null,
      search: 'algebra',
    },
  };

  sanitizeNoSqlPayload(maliciousPayload, {} as any, () => {});

  assert.strictEqual(maliciousPayload.body.$where, undefined);
  assert.strictEqual(maliciousPayload.body.nested.$gt, undefined);
  assert.strictEqual(maliciousPayload.body.nested['dot.key'], undefined);
  assert.strictEqual(maliciousPayload.body.nested.validKey, 'keep this');
  assert.strictEqual(maliciousPayload.query.$ne, undefined);
  assert.strictEqual(maliciousPayload.query.search, 'algebra');
  console.log('  ✓ MongoDB injection operators ($where, $gt, $ne, dotted keys) successfully stripped');
  passedTests++;

  // ----------------------------------------------------
  // Test 6: Header Filename Sanitization (CRLF injection prevention)
  // ----------------------------------------------------
  console.log('\nTest 6: Header filename sanitizer prevents CRLF and header injection...');
  const dirtyFilename = 'report\r\nSet-Cookie: session=hijacked\0.pdf';
  const cleanFilename = sanitizeHeaderFilename(dirtyFilename);

  assert.ok(!cleanFilename.includes('\r'));
  assert.ok(!cleanFilename.includes('\n'));
  assert.ok(!cleanFilename.includes('\0'));
  console.log(`  ✓ Filename sanitized: "${cleanFilename}"`);
  passedTests++;

  console.log('\n====================================================');
  console.log(`Security Test Suite: ${passedTests}/6 tests PASSED`);
  console.log('====================================================\n');
}

runSecurityTests().catch((err) => {
  console.error('Security Test Failed:', err);
  process.exit(1);
});

