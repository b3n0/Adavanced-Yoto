// -----------------------------------------------------------------------------
// Device registry.
//
// The Yoto account can own several players. They share one blueprint; which
// physical player a Gladys device is, is the platform id inside its
// external_id. Discovery fills the list (`discoverPlayers`), then
// `buildDiscoveredDevices` publishes it.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { getKnownPlayers, yotoPlayer } from './yotoPlayer.js';

export {
  discoverPlayers,
  getKnownPlayers,
  resetPlayerRuntime,
  setKnownPlayers,
} from './yotoPlayer.js';

export const DEVICE_BLUEPRINTS = [yotoPlayer];

export const SCENE_TRIGGER_KEYS = DEVICE_BLUEPRINTS.flatMap(
  (blueprint) => blueprint.sceneTriggers ?? [],
);

export function buildDiscoveredDevices(gladys) {
  return getKnownPlayers().map((player) => yotoPlayer.buildDevice(gladys, player));
}

export function findBlueprintByDevice(gladys, device) {
  return DEVICE_BLUEPRINTS.find((blueprint) => blueprint.ownsDevice(gladys, device));
}

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 300 s interval does not slip to 360 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

/**
 * Route `onPoll` to the owner blueprint, at the refresh interval from the
 * configuration (seconds). Gladys itself polls at most once a minute.
 * Resolves `true` when the device was read, `false` when the poll was skipped.
 * A read that throws is retried at the next poll.
 */
export function createPoller(session) {
  const lastReads = new Map();
  return async function pollDevice(gladys, device, config) {
    const blueprint = findBlueprintByDevice(gladys, device);
    if (!blueprint || typeof blueprint.onPoll !== 'function') {
      return false;
    }
    const now = Date.now();
    const lastRead = lastReads.get(device.external_id);
    if (
      lastRead !== undefined &&
      now - lastRead < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    await blueprint.onPoll(gladys, { device, config, session });
    lastReads.set(device.external_id, now);
    return true;
  };
}
