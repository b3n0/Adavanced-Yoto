// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration.
//
// Wires the SDK to the Yoto player catalog. Hardware calls live in
// src/devices/yotoPlayer.js and src/yoto-client.js. The OAuth device-code
// flow and the refresh token live in src/yoto-auth.js and src/yoto-session.js.
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
import { yotoPlayer } from './src/devices/yotoPlayer.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { pollForTokens, startDeviceAuthorization } from './src/yoto-auth.js';
import { YotoAuthError, YotoClient } from './src/yoto-client.js';
import { YotoSession } from './src/yoto-session.js';

const gladys = new GladysIntegration();

let config = normalizeConfig();
// Bumped to abandon an in-flight device-code poll (a new sign-in, or shutdown).
let linkAttempt = 0;

const SIGN_IN_STATUS = {
  en: 'Yoto sign-in was not completed. Start it again.',
  fr: 'La connexion Yoto n’a pas abouti. Relancez-la.',
};

const LINK_STATUS = {
  en: 'Link your Yoto account from the configuration screen.',
  fr: 'Liez votre compte Yoto depuis l’écran de configuration.',
};

const REVOKED_STATUS = {
  en: 'Yoto authorization is no longer valid. Link the account again.',
  fr: 'L’autorisation Yoto n’est plus valable. Liez à nouveau le compte.',
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

gladys.onOAuthAuthorizeUrl(async (key) => {
  if (key !== 'account') {
    throw new Error(`Unknown Yoto account link: ${key}`);
  }
  if (!config.client_id) {
    throw new YotoAuthError('Missing Yoto client id');
  }
  const attempt = ++linkAttempt;
  const pending = await startDeviceAuthorization(config.client_id, {
    clientSecret: config.client_secret,
  });
  // The user still has to approve in the browser. Return the page now and
  // poll in the background: the device code stays valid for several minutes.
  finishLink(attempt, pending).catch((err) => {
    logger.error('Yoto sign-in failed', err);
    gladys.setConnectionStatus(false, SIGN_IN_STATUS).catch(() => {});
  });
  return pending.verification_uri_complete || pending.verification_uri;
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
  linkAttempt += 1;
});

logger.info('Starting Yoto Player Advanced...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

async function finishLink(attempt, pending) {
  const tokens = await pollForTokens(config.client_id, pending, {
    clientSecret: config.client_secret,
    shouldStop: () => attempt !== linkAttempt,
  });
  if (!tokens || attempt !== linkAttempt) {
    return;
  }
  await persistTokens(tokens);
  const players = await reloadPlayers();
  await refreshKnownPlayers();
  await reportConnection(players);
}

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
