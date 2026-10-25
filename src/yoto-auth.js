// -----------------------------------------------------------------------------
// Yoto OAuth2. Gladys opens the verification page and this module polls until
// the family account approves it.
//
// The access token lasts a few hours. Yoto also returns a refresh token
// (scope offline_access). That refresh token is single-use: every renewal
// returns a new one, and the previous one is dead. Callers must store the
// new pair before doing anything else.
//
// Sign-in is the device-code grant: Gladys has no browser redirect of its
// own for this (account_link). The user opens Yoto's page, approves the
// family scopes, and this module polls the token endpoint until then.
// -----------------------------------------------------------------------------

import { YotoAuthError } from './yoto-client.js';

export const YOTO_AUTH_BASE = 'https://login.yotoplay.com';
export const YOTO_AUDIENCE = 'https://api.yotoplay.com';

// Scopes needed to list, control and configure players, and to renew the
// session (offline_access).
export const YOTO_SCOPES = [
  'offline_access',
  'family:view',
  'family:devices:view',
  'family:devices:control',
  'family:devices:manage',
  'family:library:view',
  'user:content:view',
  'user:icons:manage',
].join(' ');

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function startDeviceAuthorization(
  clientId,
  { fetchImpl = globalThis.fetch, clientSecret = '' } = {},
) {
  const { ok, body } = await postForm(
    `${YOTO_AUTH_BASE}/oauth/device/code`,
    {
      client_id: clientId,
      scope: YOTO_SCOPES,
      audience: YOTO_AUDIENCE,
      ...secretField(clientSecret),
    },
    fetchImpl,
  );
  if (!ok || !body.device_code || !(body.verification_uri_complete || body.verification_uri)) {
    throw new YotoAuthError('Yoto sign-in could not be started');
  }
  return body;
}

export async function pollForTokens(
  clientId,
  pending,
  { fetchImpl = globalThis.fetch, clientSecret = '', sleep = delay, shouldStop = () => false } = {},
) {
  let interval = Math.max(1, Number(pending.interval) || 5);
  const deadline = Date.now() + (Number(pending.expires_in) || 300) * 1000;

  while (Date.now() < deadline) {
    if (shouldStop()) {
      return null;
    }
    const { ok, status, body } = await postForm(
      `${YOTO_AUTH_BASE}/oauth/token`,
      {
        grant_type: DEVICE_CODE_GRANT,
        device_code: pending.device_code,
        client_id: clientId,
        audience: YOTO_AUDIENCE,
        ...secretField(clientSecret),
      },
      fetchImpl,
    );
    if (ok && body.access_token) {
      return normalizeTokens(body);
    }
    if (status === 403 && body.error === 'authorization_pending') {
      await sleep(interval * 1000);
      continue;
    }
    if (status === 403 && body.error === 'slow_down') {
      interval += 5;
      await sleep(interval * 1000);
      continue;
    }
    if (body.error === 'expired_token' || body.error === 'access_denied') {
      throw new YotoAuthError('Yoto sign-in was not completed');
    }
    throw new YotoAuthError('Yoto sign-in failed');
  }
  throw new YotoAuthError('Yoto sign-in timed out');
}

export async function refreshTokens(
  clientId,
  refreshToken,
  { fetchImpl = globalThis.fetch, clientSecret = '' } = {},
) {
  const { ok, body } = await postForm(
    `${YOTO_AUTH_BASE}/oauth/token`,
    {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      audience: YOTO_AUDIENCE,
      ...secretField(clientSecret),
    },
    fetchImpl,
  );
  if (!ok || body.error || !body.access_token) {
    throw new YotoAuthError('Yoto refresh token invalid');
  }
  return normalizeTokens(body, refreshToken);
}

// expires_in is seconds. token_expires_at is an epoch millisecond timestamp,
// which is what the session compares against Date.now().
export function normalizeTokens(body, previousRefresh = '') {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  const refreshToken =
    typeof body.refresh_token === 'string' && body.refresh_token
      ? body.refresh_token
      : previousRefresh;
  if (!accessToken || !refreshToken) {
    throw new YotoAuthError('Yoto token response was incomplete');
  }
  const expiresIn = Number(body.expires_in);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  };
}

function secretField(clientSecret) {
  const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
  return secret ? { client_secret: secret } : {};
}

async function postForm(url, fields, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new YotoAuthError('Yoto sign-in request failed');
  }
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return { ok: response.ok, status: response.status, body };
}
