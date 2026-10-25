// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. Defaults here MUST match the manifest
// `default` values. The OAuth tokens are not form fields: the device-code
// flow writes them with setConfig, outside the schema, and they survive a
// restart. Empty strings mean "not linked yet".
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  client_id: '',
  client_secret: '',
  access_token: '',
  refresh_token: '',
  token_expires_at: 0,
  // Seconds between two reads. Gladys polls at most once a minute; slower
  // intervals are applied by skipping polls (createPoller).
  poll_frequency: 300,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const expires = Number(raw.token_expires_at ?? DEFAULT_CONFIG.token_expires_at);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    client_id: text(raw.client_id),
    client_secret: text(raw.client_secret),
    access_token: text(raw.access_token),
    refresh_token: text(raw.refresh_token),
    token_expires_at: Number.isFinite(expires) ? expires : 0,
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
  };
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
