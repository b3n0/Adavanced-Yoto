// -----------------------------------------------------------------------------
// Yoto OAuth2. Gladys opens Yoto's sign-in page and receives the browser
// back on the redirect address it provides.
//
// The access token lasts a few hours. Yoto also returns a refresh token
// (scope offline_access). That refresh token is single-use: every renewal
// returns a new one, and the previous one is dead. Callers must store the
// new pair before doing anything else.
//
// Sign-in is the authorization-code grant with PKCE. New Yoto applications
// reject the device-code grant, and a public application has no secret:
// the code verifier proves the same Gladys instance finishes the sign-in.
// The verifier never leaves this process and is never written to the logs.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
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

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// The authorize URL is what the browser opens. The verifier stays here until
// Yoto redirects back; putting it in the URL would defeat PKCE.
export function createAuthorizationRequest({ clientId, redirectUri }) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  const redirect = typeof redirectUri === 'string' ? redirectUri : '';
  if (!id) {
    throw new YotoAuthError('Missing Yoto client id');
  }
  if (!redirect) {
    throw new YotoAuthError('Missing Yoto redirect address');
  }
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const url = new URL('/authorize', YOTO_AUTH_BASE);
  url.search = new URLSearchParams({
    audience: YOTO_AUDIENCE,
    scope: YOTO_SCOPES,
    response_type: 'code',
    client_id: id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  return { url: url.toString(), state, verifier, redirectUri: redirect };
}

export async function exchangeAuthorizationCode(
  clientId,
  { code, redirectUri, codeVerifier, clientSecret = '', fetchImpl = globalThis.fetch } = {},
) {
  const { ok, body } = await postForm(
    `${YOTO_AUTH_BASE}/oauth/token`,
    {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      ...secretField(clientSecret),
    },
    fetchImpl,
  );
  if (!ok || body.error || !body.access_token) {
    const err = new YotoAuthError('Yoto sign-in could not be completed');
    err.reason = typeof body.error === 'string' ? body.error : '';
    throw err;
  }
  return normalizeTokens(body);
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
