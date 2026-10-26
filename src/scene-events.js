// -----------------------------------------------------------------------------
// Scene triggers (Gladys >= 5.1).
//
// A feature already carries every value (battery, volume, playing). What it
// cannot carry is an event with its details: "Bedtime stories just started
// on Léa's player". Events come from comparing two snapshots of one player:
// one event per transition, and nothing on the first reading after a start
// (a restart must not replay "card started" for every player).
// -----------------------------------------------------------------------------

import { BATTERY_LOW_THRESHOLD, SCENE_TRIGGER } from './surfaces.js';

export { SCENE_TRIGGER };

/**
 * The battery must climb back above the threshold plus this margin, or the
 * player must be plugged in, before battery_low can fire again.
 */
const BATTERY_LOW_REARM_MARGIN = 5;

/**
 * @param {object|undefined} previous last snapshot, undefined on the first reading
 * @param {object} current new snapshot
 * @param {string} deviceExternalId value the scene editor's player filter compares
 * @returns {{ key: string, data: object }[]}
 */
export function detectSceneEvents(previous, current, deviceExternalId) {
  if (!previous) {
    return [];
  }
  const events = [];
  const base = { player: deviceExternalId, player_name: current.name };

  // A new card id while playing is a start, including a card swapped without
  // an idle reading in between.
  if (current.playing === true && current.cardId && current.cardId !== previous.cardId) {
    events.push({
      key: SCENE_TRIGGER.CARD_STARTED,
      data: { ...base, card_id: current.cardId, card_title: current.cardTitle ?? current.cardId },
    });
  }

  if (previous.playing === true && current.playing === false) {
    events.push({
      key: SCENE_TRIGGER.CARD_STOPPED,
      data: {
        ...base,
        card_id: previous.cardId,
        card_title: previous.cardTitle ?? previous.cardId,
      },
    });
  }

  if (isBatteryLow(current) && previous.batteryLowLatched !== true) {
    events.push({
      key: SCENE_TRIGGER.BATTERY_LOW,
      data: { ...base, battery: current.batteryLevel },
    });
  }

  return events;
}

/**
 * Carry the battery_low latch: set while the battery is low, cleared once
 * the player is plugged in or the level is back above the threshold + margin.
 */
export function nextBatteryLowLatch(previous, current) {
  if (isBatteryLow(current)) {
    return true;
  }
  if (current.charging === true) {
    return false;
  }
  if (
    current.batteryLevel !== null &&
    current.batteryLevel >= BATTERY_LOW_THRESHOLD + BATTERY_LOW_REARM_MARGIN
  ) {
    return false;
  }
  return previous?.batteryLowLatched === true;
}

/** Outputs of the get_player_status scene action. Unknown numbers stay null. */
export function playerStatusOutputs(snapshot) {
  return {
    player_name: snapshot.name,
    online: snapshot.online,
    battery: snapshot.batteryLevel,
    charging: snapshot.charging,
    volume: snapshot.volume,
    playing: snapshot.playing,
    card_title: snapshot.cardTitle ?? '',
    temperature: snapshot.deviceTemperature,
    wifi_signal: snapshot.wifiStrength,
    night_light: snapshot.nightLight,
    brightness: snapshot.brightness,
  };
}

function isBatteryLow(snapshot) {
  return (
    snapshot.batteryLevel !== null &&
    snapshot.batteryLevel !== undefined &&
    snapshot.batteryLevel < BATTERY_LOW_THRESHOLD &&
    snapshot.charging !== true
  );
}
