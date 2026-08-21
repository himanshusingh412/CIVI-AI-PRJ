import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, verifyAdminLogin } from '../server/adminAuth.js';

/**
 * Employee-ID + password authentication.
 *
 * The properties worth protecting here are not "a correct password works" —
 * that breaks loudly. They are the ones that fail SILENTLY and are only
 * noticed by an attacker: a hash that is really a fast digest, a comparison
 * that leaks by timing, a failure message that confirms an employee id
 * exists, and a lockout that never actually engages.
 */

const PASSWORD = 'correct-horse-battery-staple';

test('a stored hash reveals neither the password nor a reusable digest', async () => {
  const hash = await hashPassword(PASSWORD);

  assert.ok(!hash.includes(PASSWORD), 'the password must not appear in its own hash');
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);

  // Parameters travel WITH the hash so the cost can be raised later without
  // invalidating credentials already issued.
  const [, N, r, p] = hash.split('$');
  assert.ok(Number(N) >= 16384, `scrypt N too low for an interactive login: ${N}`);
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 1);
});

test('the same password hashes differently every time', async () => {
  const a = await hashPassword(PASSWORD);
  const b = await hashPassword(PASSWORD);
  // Distinct salts. Without this, identical passwords are visibly identical
  // in a leaked credential file, which hands an attacker a free frequency
  // analysis over the whole staff list.
  assert.notEqual(a, b);
  assert.ok(await verifyPassword(PASSWORD, a));
  assert.ok(await verifyPassword(PASSWORD, b));
});

test('verification rejects the wrong password and near misses', async () => {
  const hash = await hashPassword(PASSWORD);
  for (const wrong of [
    'Correct-horse-battery-staple',   // case
    'correct-horse-battery-stapl',    // truncated
    'correct-horse-battery-staple ',  // trailing space
    '',
  ]) {
    assert.equal(await verifyPassword(wrong, hash), false, `must reject ${JSON.stringify(wrong)}`);
  }
});

test('a corrupt stored hash fails the login instead of throwing', async () => {
  // A malformed credential row must not 500 the endpoint: the status code
  // would itself confirm that this employee id exists.
  for (const bad of ['', 'not-a-hash', 'scrypt$$$$', 'bcrypt$1$2$3$4$5', 'scrypt$N$r$p$!!!$!!!']) {
    assert.equal(await verifyPassword(PASSWORD, bad), false, `must reject ${JSON.stringify(bad)}`);
  }
});

// ───────────────────────── the login surface ─────────────────────────

test('an unknown employee id and a wrong password are indistinguishable', async () => {
  const unknown = await verifyAdminLogin('EMP-NOPE-0000', 'whatever-password');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'invalid_credentials');
  // No hint about existence anywhere in the result.
  assert.equal(unknown.subject, undefined);
  assert.equal(unknown.displayName, undefined);
});

test('empty credentials are refused without consulting the directory', async () => {
  for (const [id, pw] of [['', 'x'], ['EMP-0001', ''], ['', '']]) {
    const r = await verifyAdminLogin(id, pw);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid_credentials');
  }
});

test('non-string input cannot crash or bypass the check', async () => {
  // Express hands through whatever JSON contained; objects and arrays here
  // are the classic shape of a NoSQL-style auth bypass attempt.
  for (const bad of [null, undefined, 42, { $ne: null }, ['a'], true]) {
    const r = await verifyAdminLogin(bad as any, bad as any);
    assert.equal(r.ok, false, `must refuse ${JSON.stringify(bad)}`);
  }
});

test('repeated failures eventually lock the employee id out', async () => {
  const id = `EMP-LOCKTEST-${Math.floor(Date.now() % 100000)}`;
  let sawLockout = false;

  // The counter is keyed on the employee id rather than the IP, because the
  // credential is what is under attack and an attacker can trivially change
  // address. Six attempts against a five-attempt budget must trip it.
  for (let i = 0; i < 6; i++) {
    const r = await verifyAdminLogin(id, `guess-${i}`);
    if (r.reason === 'locked_out') {
      sawLockout = true;
      assert.ok((r.retryAfterSec ?? 0) > 0, 'a lockout must say how long it lasts');
      break;
    }
  }
  assert.ok(sawLockout, 'brute force against one employee id must be locked out');
});
