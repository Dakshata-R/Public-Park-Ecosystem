'use strict';

/**
 * Authentication and account management, end to end:
 * HTTP → validation → controller → MongoDB → response.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer, request, get, post, patch, login,
} = require('../helpers/harness');

const PASSWORD = 'greenpulse123';
let citizenToken;

test.before(async () => {
  await startTestServer();

  // One known account, created through the public API so the whole
  // registration path is exercised before anything else depends on it.
  const res = await post('/auth/register', {
    name: 'Test Citizen',
    email: 'test.citizen@greenpulse.gov',
    password: PASSWORD,
  });
  assert.equal(res.status, 201, `registration failed: ${JSON.stringify(res.body)}`);
  citizenToken = res.body.data.token;
});

test.after(async () => {
  await stopTestServer();
});

test('registration returns 201 with a token and never echoes the password', async () => {
  const res = await post('/auth/register', {
    name: 'Asha Menon',
    email: 'asha.menon@greenpulse.gov',
    password: PASSWORD,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.token, 'no token issued');
  assert.equal(res.body.data.user.email, 'asha.menon@greenpulse.gov');
  assert.equal(res.body.data.user.role, 'citizen', 'self-registration must not grant a privileged role');

  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes(PASSWORD), 'the plaintext password was echoed back');
  assert.ok(!/\$2[aby]\$/.test(serialised), 'the bcrypt hash was echoed back');
});

test('a registered user can sign in and read their own profile', async () => {
  const token = await login('test.citizen@greenpulse.gov');
  const me = await get('/auth/me', token);

  assert.equal(me.status, 200);
  assert.equal(me.body.data.email, 'test.citizen@greenpulse.gov');
  assert.ok(!('password' in me.body.data));
});

test('registration refuses a duplicate email with 409', async () => {
  const res = await post('/auth/register', {
    name: 'Impostor',
    email: 'test.citizen@greenpulse.gov',
    password: PASSWORD,
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.error.message.length > 0);
});

test('registration rejects malformed input with 4xx and a field-level reason', async () => {
  const cases = [
    { label: 'missing everything', body: {} },
    { label: 'invalid email', body: { name: 'X', email: 'not-an-email', password: PASSWORD } },
    { label: 'short password', body: { name: 'X', email: 'a@b.com', password: '1' } },
    { label: 'empty name', body: { name: '', email: 'b@c.com', password: PASSWORD } },
    { label: 'overlong name', body: { name: 'x'.repeat(5000), email: 'c@d.com', password: PASSWORD } },
    { label: 'wrong types', body: { name: 12345, email: [], password: {} } },
  ];

  for (const { label, body } of cases) {
    const res = await post('/auth/register', body);
    assert.ok(
      res.status === 400 || res.status === 422,
      `${label}: expected 400/422, got ${res.status}`
    );
    assert.equal(res.body.success, false, label);
  }
});

test('a privileged role cannot be granted by self-registration', async () => {
  const res = await post('/auth/register', {
    name: 'Would-be Admin',
    email: 'would.be.admin@greenpulse.gov',
    password: PASSWORD,
    role: 'admin',
  });

  assert.ok(res.status === 201 || res.status === 400 || res.status === 422);
  if (res.status === 201) {
    assert.equal(res.body.data.user.role, 'citizen', 'role escalation via the register payload');
  }
});

test('sign-in fails with 401 for a wrong password and an unknown account', async () => {
  const wrongPassword = await post('/auth/login', {
    email: 'test.citizen@greenpulse.gov',
    password: 'definitely-not-the-password',
  });
  assert.equal(wrongPassword.status, 401);

  const unknown = await post('/auth/login', {
    email: 'nobody@nowhere.gov',
    password: PASSWORD,
  });
  assert.equal(unknown.status, 401);

  // The two failures must be indistinguishable, or the endpoint becomes an
  // account-enumeration oracle.
  assert.equal(
    wrongPassword.body.error.message,
    unknown.body.error.message,
    'wrong-password and unknown-account replies differ, leaking which emails exist'
  );
});

test('protected routes reject missing, malformed and tampered tokens', async () => {
  const anonymous = await get('/auth/me');
  assert.equal(anonymous.status, 401);

  const garbage = await get('/auth/me', 'not-a-jwt');
  assert.equal(garbage.status, 401);

  const [header, payload, signature] = citizenToken.split('.');
  const tampered = `${header}.${payload}.${'x'.repeat(signature.length)}`;
  const forged = await get('/auth/me', tampered);
  assert.equal(forged.status, 401);
});

test('a token whose payload claims a different role does not gain that role', async () => {
  // Re-encode the payload with role=admin, leaving the signature untouched.
  const [header, payload, signature] = citizenToken.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.role = 'admin';
  const rePayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');

  const res = await get('/admin/users', `${header}.${rePayload}.${signature}`);
  assert.equal(res.status, 401, 'an unsigned payload edit was accepted');
});

test('a user can update their own profile but not their own role', async () => {
  const token = await login('test.citizen@greenpulse.gov');

  const updated = await patch('/auth/me', { name: 'Renamed Citizen' }, token);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, 'Renamed Citizen');

  await patch('/auth/me', { role: 'admin' }, token);
  const after = await get('/auth/me', token);
  assert.equal(after.body.data.role, 'citizen', 'self-service role escalation succeeded');
});

test('changing the password invalidates the old one and accepts the new one', async () => {
  const email = 'rotating.user@greenpulse.gov';
  await post('/auth/register', { name: 'Rotating User', email, password: PASSWORD });
  const token = await login(email);

  const changed = await post('/auth/change-password', {
    currentPassword: PASSWORD,
    newPassword: 'a-brand-new-password-123',
  }, token);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const withOld = await post('/auth/login', { email, password: PASSWORD });
  assert.equal(withOld.status, 401, 'the old password still works');

  const withNew = await post('/auth/login', { email, password: 'a-brand-new-password-123' });
  assert.equal(withNew.status, 200, 'the new password does not work');
});

test('changing the password requires the current one', async () => {
  const token = await login('test.citizen@greenpulse.gov');

  const res = await post('/auth/change-password', {
    currentPassword: 'wrong-current-password',
    newPassword: 'another-new-password-123',
  }, token);

  assert.ok(res.status === 400 || res.status === 401, `got ${res.status}`);
});

test('a malformed JSON body is a 400, not a 500', async () => {
  const res = await request('POST', '/auth/login', { raw: '{"email": "a@b.com", ' });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('email is matched case-insensitively so accounts cannot be duplicated by case', async () => {
  const res = await post('/auth/register', {
    name: 'Case Variant',
    email: 'TEST.CITIZEN@GreenPulse.gov',
    password: PASSWORD,
  });

  assert.equal(res.status, 409, 'a case variant created a second account');
});
