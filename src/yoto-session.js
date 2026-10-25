// -----------------------------------------------------------------------------
// One Yoto session for the process.
//
// The access token is reused until shortly before token_expires_at. Renewal
// goes through the refresh token, and concurrent callers share one in-flight
// renewal: two overlapping refreshes would invalidate each other, because
// Yoto refresh tokens are single-use.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { YotoAuthError } from './yoto-client.js';
import { refreshTokens } from './yoto-auth.js';

const logger = createLogger({ name: 'yoto-session' });

const REFRESH_MARGIN_MS = 60_000;

export class YotoSession {
  #getConfig;
  #persist;
  #fetch;
  #pending = null;

  constructor({ getConfig, persist, fetchImpl = globalThis.fetch }) {
    this.#getConfig = getConfig;
    this.#persist = persist;
    this.#fetch = fetchImpl;
  }

  hasCredentials() {
    const config = this.#getConfig();
    if (config.refresh_token) {
      return true;
    }
    if (!config.access_token) {
      return false;
    }
    // A token stored without an expiry (a previous manual paste) is used as-is
    // until Yoto rejects it. There is no refresh token to renew it with.
    if (!config.token_expires_at) {
      return true;
    }
    return config.token_expires_at - Date.now() > 0;
  }

  async getAccessToken() {
    const config = this.#getConfig();
    if (config.access_token && !accessTokenDue(config)) {
      return config.access_token;
    }
    if (!config.refresh_token) {
      if (config.access_token && !config.token_expires_at) {
        return config.access_token;
      }
      throw new YotoAuthError('Missing Yoto account');
    }
    return this.#refresh();
  }

  // The API rejected the access token we just sent. Renew even when the
  // recorded expiry still says it is valid.
  async forceRefresh() {
    if (!this.#getConfig().refresh_token) {
      throw new YotoAuthError('Yoto refresh token invalid');
    }
    return this.#refresh();
  }

  async #refresh() {
    if (!this.#pending) {
      this.#pending = this.#refreshOnce().finally(() => {
        this.#pending = null;
      });
    }
    return this.#pending;
  }

  async #refreshOnce() {
    const config = this.#getConfig();
    let tokens;
    try {
      tokens = await refreshTokens(config.client_id, config.refresh_token, {
        fetchImpl: this.#fetch,
        clientSecret: config.client_secret,
      });
    } catch (err) {
      logger.error('Yoto access token renewal failed');
      throw err;
    }
    await this.#persist(tokens);
    return tokens.access_token;
  }
}

function accessTokenDue(config) {
  if (!config.token_expires_at) {
    return false;
  }
  return config.token_expires_at - Date.now() <= REFRESH_MARGIN_MS;
}
