// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration.
//
// Wires the SDK to the Yoto player catalog. Hardware calls live in
// src/devices/yotoPlayer.js and src/yoto-client.js. The OAuth sign-in and the
// refresh token live in src/yoto-auth.js and src/yoto-session.js.
// Handlers are registered before connect().
//
// The supervisor injects GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR. The Yoto client id is a configuration field.
// The access token and the refresh token are written by the sign-in flow,
// outside the form.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  createPoller,
  discoverPlayers,
  findBlueprintByDevice,
  getKnownPlayers,
} from './src/devices/index.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGET, WIDGET_ACTION_REFRESH } from './src/surfaces.js';
import { buildPlayerContent, buildPlayersContent } from './src/widgets.js';
import { createAuthorizationRequest, exchangeAuthorizationCode } from './src/yoto-auth.js';
import { YotoAuthError, YotoClient } from './src/yoto-client.js';
import { YotoSession } from './src/yoto-session.js';
import {
  getSnapshot,
  getSnapshots,
  platformIdFromExternalId,
  refreshPlayersNow,
  yotoPlayer,
} from './src/devices/yotoPlayer.js';

const gladys = new GladysIntegration();

let config = normalizeConfig();
// The PKCE verifier for the sign-in that is waiting for Yoto's redirect.
// Replaced when the user starts again, and dropped once the callback arrives.
let pendingAuth = null;

const SIGN_IN_STATUS = {
  en: 'Yoto sign-in did not finish. Click Link my Yoto account again.',
  fr: 'La connexion Yoto ne s’est pas terminée. Cliquez à nouveau sur Lier mon compte Yoto.',
};

const LINK_STATUS = {
  en: 'In Allowed Callback URLs, put https://my.gladysassistant.com/redirect/oauth, save the identifier, then click Link my Yoto account.',
  fr: 'Dans Allowed Callback URLs, mettez https://my.gladysassistant.com/redirect/oauth, enregistrez l’identifiant, puis cliquez sur Lier mon compte Yoto.',
};

const REVOKED_STATUS = {
  en: 'The Yoto account needs to be linked again.',
  fr: 'Il faut lier à nouveau le compte Yoto.',
};

const INIT_STATUS = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
};

const session = new YotoSession({
  getConfig: () => config,
  persist: persistTokens,
});

const pollDevice = createPoller(session);

gladys.onOAuthAuthorizeUrl(async (key, redirectUri) => {
  if (key !== 'account') {
    throw new Error(`Unknown Yoto account link: ${key}`);
  }
  const request = createAuthorizationRequest({ clientId: config.client_id, redirectUri });
  pendingAuth = request;
  return request.url;
});

gladys.onOAuthCallback(async (key, { code, state, redirectUri }) => {
  if (key !== 'account') {
    throw new Error(`Unknown Yoto account link: ${key}`);
  }
  const pending = pendingAuth;
  pendingAuth = null;
  if (!pending || state !== pending.state || !code) {
    await gladys.setConnectionStatus(false, SIGN_IN_STATUS).catch(() => {});
    throw new YotoAuthError('Yoto sign-in could not be completed');
  }
  try {
    const tokens = await exchangeAuthorizationCode(config.client_id, {
      code,
      redirectUri: redirectUri || pending.redirectUri,
      codeVerifier: pending.verifier,
      clientSecret: config.client_secret,
    });
    await persistTokens(tokens);
    const players = await reloadPlayers();
    await refreshKnownPlayers();
    await reportConnection(players);
  } catch (err) {
    logger.error('Yoto sign-in could not be completed', err.reason || '');
    await gladys.setConnectionStatus(false, SIGN_IN_STATUS).catch(() => {});
    throw err;
  }
});

gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing Yoto players');
  await reloadPlayers();
});

gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  const blueprint = findBlueprintByDevice(gladys, device);
  if (!blueprint || typeof blueprint.onSetValue !== 'function') {
    throw new Error(`No command handler for ${device.external_id}`);
  }
  await blueprint.onSetValue(gladys, { device, feature, value, config, session });
});

gladys.onPoll(async (device) => {
  if (!(await pollDevice(gladys, device, config))) {
    logger.debug(`onPoll skipped (not due) for ${device.external_id}`);
  }
});

for (const blueprint of DEVICE_BLUEPRINTS) {
  for (const [actionKey, handler] of Object.entries(blueprint.actions ?? {})) {
    gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config, session }));
  }
}

for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, config, session }));
}

gladys.onWidgetGet(WIDGET.PLAYERS, async () =>
  buildPlayersContent(getKnownPlayers(), getSnapshots()),
);

gladys.onWidgetGet(WIDGET.PLAYER, async ({ settings }) => {
  const deviceId = platformIdFromExternalId(settings?.player);
  const player = getKnownPlayers().find((item) => item.deviceId === deviceId) ?? null;
  return buildPlayerContent(gladys, player, deviceId ? getSnapshot(deviceId) : undefined);
});

gladys.onWidgetAction(WIDGET.PLAYERS, async (actionKey) => {
  assertWidgetAction(actionKey);
  const count = await refreshPlayersNow(gladys, { config, session });
  return {
    en: `${count} player(s) refreshed.`,
    fr: `${count} lecteur(s) rafraîchi(s).`,
  };
});

gladys.onWidgetAction(WIDGET.PLAYER, async (actionKey, _params, { settings }) => {
  assertWidgetAction(actionKey);
  const deviceId = platformIdFromExternalId(settings?.player);
  const player = getKnownPlayers().find((item) => item.deviceId === deviceId);
  if (!player) {
    throw new Error('This Yoto player is no longer on the account.');
  }
  await yotoPlayer.onPoll(gladys, {
    device: { external_id: yotoPlayer.deviceExternalId(gladys, player.deviceId) },
    config,
    session,
  });
  return {
    en: `${player.name} refreshed.`,
    fr: `${player.name} rafraîchi.`,
  };
});

function assertWidgetAction(actionKey) {
  if (actionKey !== WIDGET_ACTION_REFRESH) {
    throw new Error(`Unknown widget action "${actionKey}"`);
  }
}

gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  const next = normalizeConfig(newConfig);
  // A token renewal writes the config and Gladys echoes it here. The session
  // is already the one we just stored: rediscovering would overlap the renewal.
  const sameSession =
    next.client_id === config.client_id &&
    next.client_secret === config.client_secret &&
    next.poll_frequency === config.poll_frequency &&
    next.access_token === config.access_token &&
    next.refresh_token === config.refresh_token;
  config = next;
  if (sameSession) {
    return;
  }
  if (!session.hasCredentials()) {
    await gladys.setConnectionStatus(false, LINK_STATUS);
    return;
  }
  try {
    const players = await reloadPlayers();
    await refreshKnownPlayers();
    await reportConnection(players);
  } catch (err) {
    logger.error('Configuration reload failed', err);
    await reportFailure(err);
  }
});

gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    if (!session.hasCredentials()) {
      logger.info('Yoto account is not linked yet');
      await gladys.setConnectionStatus(false, LINK_STATUS);
      return;
    }
    const players = await reloadPlayers();
    await refreshKnownPlayers();
    await reportConnection(players);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await reportFailure(err);
  }
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  pendingAuth = null;
});

logger.info('Starting Yoto Player Advanced...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

async function persistTokens(partial) {
  config = normalizeConfig({ ...config, ...partial });
  await gladys.setConfig({
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    token_expires_at: config.token_expires_at,
  });
}

async function reloadPlayers() {
  if (!session.hasCredentials()) {
    throw new YotoAuthError('Missing Yoto account');
  }
  const client = new YotoClient(session);
  await discoverPlayers(client);
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys));
  return getKnownPlayers();
}

async function refreshKnownPlayers() {
  for (const player of getKnownPlayers()) {
    try {
      await yotoPlayer.onPoll(gladys, {
        device: { external_id: yotoPlayer.deviceExternalId(gladys, player.deviceId) },
        config,
        session,
      });
    } catch (err) {
      logger.error(`Initial poll failed for ${player.deviceId}`, err);
    }
  }
}

async function reportConnection(players) {
  if (players.length === 0) {
    await gladys.setConnectionStatus(true, {
      en: 'Connected, but this account has no Yoto player.',
      fr: "Connecté, mais ce compte n'a aucun Yoto Player.",
    });
    return;
  }
  await gladys.setConnectionStatus(true);
}

async function reportFailure(err) {
  const message =
    err instanceof YotoAuthError
      ? config.refresh_token
        ? REVOKED_STATUS
        : LINK_STATUS
      : INIT_STATUS;
  await gladys.setConnectionStatus(false, message).catch(() => {});
}
