// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Playing a card takes a string id. Device features only carry numbers, so
// the scene editor collects the card id as a field and this handler posts it.
// `fields` arrive already resolved. Throwing fails this action only.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { YotoClient } from './yoto-client.js';
import { platformIdFromExternalId } from './devices/yotoPlayer.js';

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
};
