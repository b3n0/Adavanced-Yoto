import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YotoAuthError } from '../src/yoto-client.js';
import { YotoSession } from '../src/yoto-session.js';
import {
  normalizeTokens,
  pollForTokens,
  refreshTokens,
  startDeviceAuthorization,
} from '../src/yoto-auth.js';

const REFRESH = 'refresh-token-value';
const NEXT_REFRESH = 'next-refresh-token';

function form(init) {
  return Object.fromEntries(new URLSearchParams(init.body));
}

test('normalizeTokens keeps a new single-use refresh token and an expiry', () => {
  const before = Date.now();
  const tokens = normalizeTokens(
    { access_token: 'access', refresh_token: NEXT_REFRESH, expires_in: 7200 },
    REFRESH,
  );
  assert.equal(tokens.access_token, 'access');
  assert.equal(tokens.refresh_token, NEXT_REFRESH);
  assert.ok(tokens.token_expires_at >= before + 7200 * 1000);
  assert.equal(JSON.stringify(tokens).includes('Bearer'), false);
});

test('normalizeTokens keeps the previous refresh token when Yoto omits one', () => {
  const tokens = normalizeTokens({ access_token: 'access', expires_in: 60 }, REFRESH);
  assert.equal(tokens.refresh_token, REFRESH);
});

test('device-code sign-in polls until the user approves, then returns both tokens', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), fields: form(init) });
    if (String(url).endsWith('/oauth/device/code')) {
      return json({
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://login.yotoplay.com/activate',
        verification_uri_complete: 'https://login.yotoplay.com/activate?user_code=ABCD-EFGH',
        expires_in: 300,
        interval: 5,
      });
    }
    if (calls.filter((call) => call.url.endsWith('/oauth/token')).length === 1) {
      return json({ error: 'authorization_pending' }, 403);
    }
    return json({ access_token: 'access', refresh_token: REFRESH, expires_in: 3600 });
  };

  const pending = await startDeviceAuthorization('client-id', { fetchImpl });
  const tokens = await pollForTokens('client-id', pending, { fetchImpl, sleep: async () => {} });

  assert.equal(pending.verification_uri_complete.includes('ABCD-EFGH'), true);
  assert.equal(calls[0].fields.scope.includes('offline_access'), true);
  assert.equal(calls[0].fields.scope.includes('family:devices:control'), true);
  assert.equal(calls[1].fields.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(tokens.access_token, 'access');
  assert.equal(tokens.refresh_token, REFRESH);
});

test('refresh replaces the refresh token and does not echo it in the error', async () => {
  await assert.rejects(
    refreshTokens('client-id', REFRESH, {
      fetchImpl: async (_url, init) => {
        assert.equal(form(init).refresh_token, REFRESH);
        return json({ error: 'invalid_grant' }, 403);
      },
    }),
    (err) => {
      assert.ok(err instanceof YotoAuthError);
      assert.equal(err.message.includes(REFRESH), false);
      return true;
    },
  );

  const tokens = await refreshTokens('client-id', REFRESH, {
    fetchImpl: async () =>
      json({ access_token: 'new-access', refresh_token: NEXT_REFRESH, expires_in: 3600 }),
  });
  assert.equal(tokens.refresh_token, NEXT_REFRESH);
  assert.equal(tokens.access_token, 'new-access');
});

test('a fresh access token is reused, and one renewal serves concurrent callers', async () => {
  let config = {
    client_id: 'client-id',
    client_secret: '',
    access_token: 'still-valid',
    refresh_token: REFRESH,
    token_expires_at: Date.now() + 10 * 60 * 1000,
  };
  let refreshes = 0;
  const session = new YotoSession({
    getConfig: () => config,
    persist: async (tokens) => {
      config = { ...config, ...tokens };
    },
    fetchImpl: async () => {
      refreshes += 1;
      return json({ access_token: 'renewed', refresh_token: NEXT_REFRESH, expires_in: 3600 });
    },
  });

  assert.equal(await session.getAccessToken(), 'still-valid');
  assert.equal(refreshes, 0);

  config = { ...config, token_expires_at: Date.now() + 1000 };
  const [first, second] = await Promise.all([session.getAccessToken(), session.getAccessToken()]);
  assert.equal(first, 'renewed');
  assert.equal(second, 'renewed');
  assert.equal(refreshes, 1);
  assert.equal(config.refresh_token, NEXT_REFRESH);
});

test('a rejected access token is renewed once', async () => {
  const { YotoClient } = await import('../src/yoto-client.js');
  let calls = 0;
  const session = {
    hasCredentials: () => true,
    getAccessToken: async () => (calls === 0 ? 'expired' : 'renewed'),
    forceRefresh: async () => 'renewed',
  };
  const client = new YotoClient(session, async (_url, init) => {
    calls += 1;
    if (init.headers.Authorization === 'Bearer expired') {
      return json({ error: 'unauthorized' }, 401);
    }
    return json({ devices: [] });
  });
  assert.deepEqual(await client.listDevices(), { devices: [] });
  assert.equal(calls, 2);
});

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}
