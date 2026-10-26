import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSceneEvents,
  nextBatteryLowLatch,
  playerStatusOutputs,
} from '../src/scene-events.js';
import { SCENE_TRIGGER } from '../src/surfaces.js';

const player = 'gladys:yoto-player:abc';

function snapshot(partial) {
  return {
    name: 'Chambre',
    online: true,
    batteryLevel: 80,
    charging: false,
    volume: 40,
    playing: false,
    cardId: null,
    cardTitle: null,
    deviceTemperature: 30,
    wifiStrength: -50,
    nightLight: false,
    brightness: 40,
    ...partial,
  };
}

test('the first reading fires nothing', () => {
  const current = snapshot({ playing: true, cardId: 'abc', cardTitle: 'Histoires' });
  assert.deepEqual(detectSceneEvents(undefined, current, player), []);
});

test('a new card fires card_started, and stopping fires card_stopped once', () => {
  const idle = snapshot();
  const playing = snapshot({ playing: true, cardId: 'abc', cardTitle: 'Histoires' });
  const started = detectSceneEvents(idle, playing, player);
  assert.equal(started.length, 1);
  assert.equal(started[0].key, SCENE_TRIGGER.CARD_STARTED);
  assert.equal(started[0].data.card_id, 'abc');
  assert.equal(started[0].data.player, player);

  const stopped = detectSceneEvents(playing, idle, player);
  assert.equal(stopped[0].key, SCENE_TRIGGER.CARD_STOPPED);
  assert.equal(stopped[0].data.card_title, 'Histoires');
  assert.deepEqual(detectSceneEvents(idle, idle, player), []);
});

test('battery_low fires once until the battery climbs back or the player is plugged in', () => {
  const fine = snapshot({ batteryLevel: 40 });
  const low = snapshot({ batteryLevel: 15, charging: false });
  const events = detectSceneEvents(fine, low, player);
  assert.equal(events[0].key, SCENE_TRIGGER.BATTERY_LOW);
  assert.equal(events[0].data.battery, 15);

  const latched = { ...low, batteryLowLatched: nextBatteryLowLatch(fine, low) };
  assert.equal(latched.batteryLowLatched, true);
  assert.deepEqual(detectSceneEvents(latched, { ...low, batteryLevel: 12 }, player), []);

  const plugged = snapshot({ batteryLevel: 15, charging: true });
  assert.equal(nextBatteryLowLatch(latched, plugged), false);
  assert.deepEqual(detectSceneEvents(latched, plugged, player), []);
});

test('player status outputs use the manifest keys', () => {
  const outputs = playerStatusOutputs(snapshot({ playing: true, cardTitle: 'Histoires' }));
  assert.equal(outputs.player_name, 'Chambre');
  assert.equal(outputs.card_title, 'Histoires');
  assert.equal(outputs.volume, 40);
  assert.equal(outputs.night_light, false);
});
