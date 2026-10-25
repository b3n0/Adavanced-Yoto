import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YotoAuthError } from '../src/yoto-client.js';
import { YotoSession } from '../src/yoto-session.js';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  normalizeTokens,
  refreshTokens,
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

test('the sign-in page carries the Gladys redirect address and hides the verifier', () => {
  const redirectUri = 'https://example.test/callback';
  const request = createAuthorizationRequest({ clientId: ' client-id ', redirectUri });
  const url = new URL(request.url);

  assert.equal(`${url.origin}${url.pathname}`, 'https://login.yotoplay.com/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), request.state);
  assert.equal(url.searchParams.get('scope').includes('offline_access'), true);
  assert.equal(
    url.searchParams.get('code_challenge'),
    createHash('sha256').update(request.verifier).digest('base64url'),
  );
  assert.equal(request.url.includes(request.verifier), false);
});

test('the authorization code is exchanged with the same redirect address', async () => {
  const redirectUri = 'https://example.test/callback';
  const code = 'one-time-code';
  let sent;
  const tokens = await exchangeAuthorizationCode('client-id', {
    code,
    redirectUri,
    codeVerifier: 'verifier-value',
    fetchImpl: async (url, init) => {
      sent = { url: String(url), fields: form(init) };
      return json({ access_token: 'access', refresh_token: REFRESH, expires_in: 3600 });
    },
  });

  assert.equal(sent.url, 'https://login.yotoplay.com/oauth/token');
  assert.equal(sent.fields.grant_type, 'authorization_code');
  assert.equal(sent.fields.redirect_uri, redirectUri);
  assert.equal(sent.fields.code, code);
  assert.equal(sent.fields.code_verifier, 'verifier-value');
  assert.equal(sent.fields.client_secret, undefined);
  assert.equal(tokens.access_token, 'access');
  assert.equal(tokens.refresh_token, REFRESH);
});

test('a refused sign-in does not repeat the authorization code', async () => {
  const code = 'one-time-code';
  await assert.rejects(
    exchangeAuthorizationCode('client-id', {
      code,
      redirectUri: 'https://example.test/callback',
      codeVerifier: 'verifier-value',
      fetchImpl: async () => json({ error: 'invalid_grant', error_description: code }, 403),
    }),
    (err) => {
      assert.ok(err instanceof YotoAuthError);
      assert.equal(err.reason, 'invalid_grant');
      assert.equal(err.message.includes(code), false);
      return true;
    },
  );
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
