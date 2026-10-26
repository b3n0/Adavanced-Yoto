// -----------------------------------------------------------------------------
// Yoto REST client.
//
// The bearer token is an OAuth access token (see src/yoto-session.js). It is
// sent on every request and never written to a log line: an error body is not
// logged either, because a proxy can echo the Authorization header back.
// A 401/403 retries once after a refresh when a session is attached.
//
// Paths are the documented device API on api.yotoplay.com. A PUT on /config
// replaces the whole configuration block (omitted keys fall back to firmware
// defaults), so every settings write re-reads and merges. Live commands
// (volume, the light ring, card playback) are the HTTP form of the MQTT
// command topics: POST /device-v2/{id}/command/<topic>.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'yoto' });

export const YOTO_API_BASE = 'https://api.yotoplay.com';

// One request must return inside Gladys' command acknowledgement window
// (5 s for onSetValue). Settings need a read plus a write, so each call stays
// short and the poll reconciles anything that missed the window.
const REQUEST_TIMEOUT_MS = 4000;

// The player knob has 17 steps (0–16). The command API speaks percents.
// This is the scale the Yoto app uses between the two.
const VOLUME_STEP_TO_PERCENT = [0, 7, 13, 19, 25, 32, 38, 44, 50, 57, 63, 69, 75, 82, 88, 94, 100];

const OFF_COLORS = new Set(['#0', '#000', '#000000', '0', 'off']);

export class YotoApiError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = 'YotoApiError';
    this.status = status;
    this.path = path;
  }
}

export class YotoAuthError extends YotoApiError {
  constructor(message, details) {
    super(message, details);
    this.name = 'YotoAuthError';
  }
}

export function volumeStepToPercent(step) {
  const index = Math.max(0, Math.min(VOLUME_STEP_TO_PERCENT.length - 1, Math.round(Number(step))));
  return VOLUME_STEP_TO_PERCENT[index];
}

export function percentToVolumeStep(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) {
    return null;
  }
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < VOLUME_STEP_TO_PERCENT.length; index += 1) {
    const distance = Math.abs(VOLUME_STEP_TO_PERCENT[index] - value);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

export function isOffColor(hex) {
  if (hex == null) {
    return true;
  }
  return OFF_COLORS.has(String(hex).trim().toLowerCase());
}

export function hexToInt(hex) {
  if (isOffColor(hex)) {
    return 0;
  }
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!match) {
    return 0;
  }
  return Number.parseInt(match[1], 16);
}

// Gladys stores a light color as a 24-bit integer, not a hex string.
export function intToHex(value) {
  const parsed = Number(value);
  const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(0xffffff, Math.round(parsed))) : 0;
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

export function hexToRgb(hex) {
  const value = hexToInt(hex);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export class YotoClient {
  #getAccessToken;
  #forceRefresh;
  #hasToken;
  #fetch;

  // A string is a fixed access token (tests, or a token with no session).
  // A session renews it. The two are not mixed in one instance.
  constructor(accessTokenOrSession, fetchImpl = globalThis.fetch) {
    this.#fetch = fetchImpl;
    if (accessTokenOrSession && typeof accessTokenOrSession.getAccessToken === 'function') {
      this.#getAccessToken = () => accessTokenOrSession.getAccessToken();
      this.#forceRefresh =
        typeof accessTokenOrSession.forceRefresh === 'function'
          ? () => accessTokenOrSession.forceRefresh()
          : null;
      this.#hasToken = () =>
        typeof accessTokenOrSession.hasCredentials === 'function'
          ? accessTokenOrSession.hasCredentials()
          : true;
    } else {
      const token = typeof accessTokenOrSession === 'string' ? accessTokenOrSession.trim() : '';
      this.#getAccessToken = async () => {
        if (!token) {
          throw new YotoAuthError('Missing Yoto access token');
        }
        return token;
      };
      this.#forceRefresh = null;
      this.#hasToken = () => token.length > 0;
    }
  }

  get hasToken() {
    return this.#hasToken();
  }

  async listDevices() {
    return this.#request('GET', '/device-v2/devices/mine');
  }

  async getConfig(deviceId) {
    return this.#request('GET', `/device-v2/${encodeURIComponent(deviceId)}/config`);
  }

  // The player answers over MQTT; the cloud then stores the report we read.
  async requestStatusPush(deviceId) {
    await this.#request('POST', `/device-v2/${encodeURIComponent(deviceId)}/command/status`, {});
  }

  // Title, author and cover. A missing field stays null. Needs family:library:view.
  async getCard(cardId) {
    const payload = await this.#request('GET', `/card/${encodeURIComponent(cardId)}`);
    const card = payload?.card ?? payload ?? {};
    const metadata = card.metadata ?? {};
    return {
      title: nonEmpty(card.title) ?? nonEmpty(metadata.title),
      author: nonEmpty(metadata.author),
      coverUrl: httpsUrl(metadata.cover?.imageL),
    };
  }

  // Re-reads first: a partial PUT would reset every setting it does not repeat.
  async updateSettings(deviceId, partial) {
    const current = await this.getConfig(deviceId);
    const raw = current?.device?.config;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new YotoApiError(`Yoto player ${deviceId} returned no config to update`, {
        path: `/device-v2/${deviceId}/config`,
      });
    }
    await this.#request('PUT', `/device-v2/${encodeURIComponent(deviceId)}/config`, {
      deviceId,
      config: { ...raw, ...partial },
    });
  }

  async setVolume(deviceId, percent) {
    await this.#request('POST', `/device-v2/${encodeURIComponent(deviceId)}/command/volume/set`, {
      volume: percent,
    });
  }

  async setAmbient(deviceId, red, green, blue) {
    await this.#request('POST', `/device-v2/${encodeURIComponent(deviceId)}/command/ambients/set`, {
      r: red,
      g: green,
      b: blue,
    });
  }

  // trackIndex 0 is the first track. Yoto track keys are 1-based ("01").
  async playCard(deviceId, cardId, trackIndex = 0) {
    const id = typeof cardId === 'string' ? cardId.trim() : '';
    const uri = cardUri(id);
    const index = Number(trackIndex);
    const step = Number.isFinite(index) ? Math.max(0, Math.round(index)) : 0;
    const trackKey = String(step + 1).padStart(2, '0');
    await this.#request('POST', `/device-v2/${encodeURIComponent(deviceId)}/command/card/start`, {
      uri,
      chapterKey: '01',
      trackKey,
    });
  }

  async #request(method, path, body, attempt = 0) {
    const token = await this.#getAccessToken();
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await this.#fetch(`${YOTO_API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof YotoApiError) {
        throw err;
      }
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      const detail = redact(err?.message ?? 'failed', token);
      throw new YotoApiError(
        timedOut ? `Yoto ${method} ${path} timed out` : `Yoto ${method} ${path} failed: ${detail}`,
        {
          path,
        },
      );
    }

    const text = await response.text();
    // Yoto answers 401 or 403 when the access token has lapsed. One renewal,
    // then the error stands: a second failure is a revoked authorization.
    if (
      (response.status === 401 || response.status === 403) &&
      attempt === 0 &&
      this.#forceRefresh
    ) {
      await this.#forceRefresh();
      return this.#request(method, path, body, attempt + 1);
    }
    if (response.status === 401 || response.status === 403) {
      // Status and path only: the body can repeat the rejected credential.
      logger.error(`Yoto access token rejected (HTTP ${response.status}) on ${method} ${path}`);
      throw new YotoAuthError('Yoto access token expired, invalid, or missing permission', {
        status: response.status,
        path,
      });
    }
    if (!response.ok) {
      logger.error(`Yoto ${method} ${path} failed (HTTP ${response.status})`);
      throw new YotoApiError(`Yoto ${method} ${path} failed (HTTP ${response.status})`, {
        status: response.status,
        path,
      });
    }
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new YotoApiError(`Yoto ${method} ${path} returned invalid JSON`, {
        status: response.status,
        path,
      });
    }
  }
}

function redact(text, token) {
  const value = String(text ?? '');
  if (!token) {
    return value;
  }
  return value.split(token).join('[redacted]');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function httpsUrl(value) {
  const url = nonEmpty(value);
  return url !== null && url.startsWith('https://') ? url : null;
}

function cardUri(cardId) {
  if (cardId.startsWith('https://yoto.io/')) {
    return cardId;
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cardId)) {
    throw new YotoApiError('A Yoto card id is required');
  }
  return `https://yoto.io/${cardId}`;
}
