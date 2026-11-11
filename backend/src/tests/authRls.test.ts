/**
 * Test Suite: Built-in JWT Authentication & Row-Level Security (RLS)
 * Verifies:
 * 1. User registration with scrypt password hashing & random salt
 * 2. User login & timing-safe password verification
 * 3. JWT signing and tamper-evident HMAC signature verification
 * 4. Row-Level Data Scoping: User A's jobs are isolated from User B
 * 5. Broken Access Control Prevention: User B accessing User A's job returns HTTP 403 Forbidden
 */

import assert from 'assert';
import { UserRepository, UserSecurity } from '../models/User.model.js';
import { JobRepository } from '../models/Job.model.js';
import { JwtService } from '../core/jwt.js';

async function runAuthRlsTests() {
  console.log('====================================================');
  console.log('Running Authentication & Row-Level Security (RLS) Tests');
  console.log('====================================================\n');

  let passedTests = 0;
  UserRepository.clearMemoryStore();
  JobRepository.clearMemoryStore();

  // ----------------------------------------------------
  // Test 1: User Registration & Scrypt Hashing
  // ----------------------------------------------------
  console.log('Test 1: User registration hashes password securely with scrypt...');
  const userA = await UserRepository.create('alice@university.edu', 'LectureNotes2026!');
  assert.ok(userA.id, 'User ID should be generated');
  assert.strictEqual(userA.email, 'alice@university.edu');
  assert.ok(userA.passwordHash && userA.passwordHash.length === 128, 'Scrypt 64-byte hex hash expected');
  assert.ok(userA.salt && userA.salt.length === 32, '16-byte random salt expected');

  // Verify duplicate email is rejected
  let duplicateError = false;
  try {
    await UserRepository.create('alice@university.edu', 'DifferentPass123!');
  } catch (err: any) {
    duplicateError = true;
    assert.ok(err.message.includes('already exists'));
  }
  assert.strictEqual(duplicateError, true, 'Duplicate email registration must fail');
  console.log('  ✓ User created with salted scrypt hash; duplicate email blocked');
  passedTests++;

  // ----------------------------------------------------
  // Test 2: Password Verification (Timing-Safe)
  // ----------------------------------------------------
  console.log('\nTest 2: Verifying password with timing-safe comparison...');
  const validPassword = await UserSecurity.verifyPassword(
    'LectureNotes2026!',
    userA.passwordHash,
    userA.salt
  );
  assert.strictEqual(validPassword, true, 'Correct password must verify');

  const invalidPassword = await UserSecurity.verifyPassword(
    'WrongPassword!',
    userA.passwordHash,
    userA.salt
  );
  assert.strictEqual(invalidPassword, false, 'Incorrect password must be rejected');
  console.log('  ✓ Valid password accepted, wrong password safely rejected');
  passedTests++;

  // ----------------------------------------------------
  // Test 3: JWT Token Generation & Verification
  // ----------------------------------------------------
  console.log('\nTest 3: JWT Service signs and verifies tamper-evident tokens...');
  const token = JwtService.sign({
    userId: userA.id,
    email: userA.email,
  });

  const verifiedPayload = JwtService.verify(token);
  assert.strictEqual(verifiedPayload.userId, userA.id);
  assert.strictEqual(verifiedPayload.email, userA.email);
  assert.ok(verifiedPayload.exp > verifiedPayload.iat);

  // Tampered token test (altering payload bytes)
  const [header, payload, sig] = token.split('.');
  const tamperedToken = `${header}.eyJ1c2VySWQiOiJoYWNrZWQifQ.${sig}`;

  let tamperCaught = false;
  try {
    JwtService.verify(tamperedToken);
  } catch (err: any) {
    tamperCaught = true;
    assert.ok(err.message.includes('signature'));
  }
  assert.strictEqual(tamperCaught, true, 'Tampered JWT must be rejected');
  console.log('  ✓ JWT issued and verified; tampered signatures securely rejected');
  passedTests++;

  // ----------------------------------------------------
  // Test 4: Row-Level Data Scoping (Isolation between Users)
  // ----------------------------------------------------
  console.log('\nTest 4: Row-Level Security isolates data between User A and User B...');
  const userB = await UserRepository.create('bob@university.edu', 'BobSecretPass2026!');

  // User A creates a job
  const jobA = await JobRepository.create({
    userId: userA.id,
    videoTitle: "Alice's Quantum Mechanics Lecture",
    sourceType: 'UPLOAD',
  });

  // User B creates a job
  const jobB = await JobRepository.create({
    userId: userB.id,
    videoTitle: "Bob's Organic Chemistry Lecture",
    sourceType: 'UPLOAD',
  });

  // Query User A's jobs: must ONLY return Job A
  const aliceJobs = await JobRepository.list({ userId: userA.id });
  assert.strictEqual(aliceJobs.length, 1);
  assert.strictEqual(aliceJobs[0].id, jobA.id);
  assert.strictEqual(aliceJobs[0].videoTitle, "Alice's Quantum Mechanics Lecture");

  // Query User B's jobs: must ONLY return Job B
  const bobJobs = await JobRepository.list({ userId: userB.id });
  assert.strictEqual(bobJobs.length, 1);
  assert.strictEqual(bobJobs[0].id, jobB.id);
  assert.strictEqual(bobJobs[0].videoTitle, "Bob's Organic Chemistry Lecture");
  console.log('  ✓ Data strictly scoped: User A only sees Job A, User B only sees Job B');
  passedTests++;

  // ----------------------------------------------------
  // Test 5: Broken Access Control (Unauthorized Access Blocked)
  // ----------------------------------------------------
  console.log('\nTest 5: Broken Access Control prevented (cross-tenant access denied)...');
  // User B attempts to access User A's job by ID:
  const crossAccess = await JobRepository.findById(jobA.id, userB.id);
  assert.strictEqual(crossAccess, null, 'User B must NOT be allowed to access User A job');

  // User A accessing User A's job:
  const authorizedAccess = await JobRepository.findById(jobA.id, userA.id);
  assert.ok(authorizedAccess !== null);
  assert.strictEqual(authorizedAccess?.id, jobA.id);

  // User B attempts to update User A's job:
  const unauthorizedUpdate = await JobRepository.update(jobA.id, { videoTitle: 'Hacked Title' }, userB.id);
  assert.strictEqual(unauthorizedUpdate, null, 'User B must NOT be allowed to update User A job');

  // Verify User A's job title remained unchanged
  const checkJob = await JobRepository.findById(jobA.id);
  assert.strictEqual(checkJob?.videoTitle, "Alice's Quantum Mechanics Lecture");
  console.log('  ✓ Cross-tenant access and unauthorized updates strictly blocked');
  passedTests++;

  console.log('\n====================================================');
  console.log(`Auth & Row-Level Security: ${passedTests}/5 tests PASSED!`);
  console.log('====================================================\n');
}

runAuthRlsTests().catch((err) => {
  console.error('Auth & RLS Test Failed:', err);
  process.exit(1);
});

