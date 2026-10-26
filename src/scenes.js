// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Playing a card takes a string id. Device features only carry numbers, so
// the scene editor collects the card id as a field and this handler posts it.
// `fields` arrive already resolved. Throwing fails this action only.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { playerStatusOutputs } from './scene-events.js';
import { YotoClient } from './yoto-client.js';
import {
  getSnapshot,
  platformIdFromExternalId,
  refreshPlayersNow,
  yotoPlayer,
} from './devices/yotoPlayer.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  async play_card(_gladys, { fields, config, session }) {
    const deviceId = platformIdFromExternalId(fields.device);
    if (!deviceId) {
      throw new Error('Choose a Yoto player');
    }
    logger.info(`Scene action play_card <- ${deviceId}`);
    await new YotoClient(session ?? config.access_token).playCard(
      deviceId,
      fields.card_id,
      fields.track_index ?? 0,
    );
    return { playing: true };
  },

  async get_player_status(gladys, { fields, config, session }) {
    const deviceId = platformIdFromExternalId(fields.player);
    if (!deviceId) {
      throw new Error('Choose a Yoto player');
    }
    logger.info(`Scene action get_player_status <- ${deviceId}`);
    await yotoPlayer.onPoll(gladys, {
      device: { external_id: fields.player },
      config,
      session,
    });
    const snapshot = getSnapshot(deviceId);
    if (!snapshot) {
      throw new Error('The Yoto player could not be read');
    }
    return playerStatusOutputs(snapshot);
  },

  async refresh_players(gladys, context) {
    const count = await refreshPlayersNow(gladys, context);
    return { count };
  },
};
