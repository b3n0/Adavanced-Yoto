import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  createPoller,
  findBlueprintByDevice,
} from '../src/devices/index.js';
import { FEATURE, resetPlayerRuntime, setKnownPlayers } from '../src/devices/yotoPlayer.js';
import { normalizeConfig } from '../src/config.js';

const config = normalizeConfig({ access_token: 'secret-token' });

function seedPlayers() {
  resetPlayerRuntime();
  setKnownPlayers([
    { deviceId: 'player-1', name: 'Chambre' },
    { deviceId: 'player-2', name: 'Salon' },
  ]);
}

test('every blueprint exposes the required shape', () => {
  for (const blueprint of DEVICE_BLUEPRINTS) {
    assert.equal(typeof blueprint.key, 'string');
    assert.equal(typeof blueprint.deviceExternalId, 'function');
    assert.equal(typeof blueprint.ownsDevice, 'function');
    assert.equal(typeof blueprint.buildDevice, 'function');
  }
});

test('buildDiscoveredDevices returns one payload per player', () => {
  seedPlayers();
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys);
  assert.equal(devices.length, 2);
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Chambre', 'Salon'],
  );
});

test('Gladys accepts the discovery payload', async () => {
  seedPlayers();
  const gladys = createFakeGladys();
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys));
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('a player declares the Yoto features Gladys can address', () => {
  seedPlayers();
  const gladys = createFakeGladys();
  const device = buildDiscoveredDevices(gladys)[0];
  const byType = (category, type) =>
    device.features.filter((item) => item.category === category && item.type === type);
  assert.equal(
    byType(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.BINARY).length,
    1,
  );
  const color = byType(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.COLOR)[0];
  assert.equal(color.min, 0);
  assert.equal(color.max, 0xffffff);
  assert.equal(
    byType(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS).length,
    1,
  );
  assert.equal(
    byType(DEVICE_FEATURE_CATEGORIES.MUSIC, DEVICE_FEATURE_TYPES.MUSIC.VOLUME).length,
    3,
  );
  const battery = byType(
    DEVICE_FEATURE_CATEGORIES.BATTERY,
    DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
  )[0];
  assert.equal(battery.read_only, true);
  assert.equal(battery.min, 0);
  assert.equal(battery.max, 100);
  const limits = device.features.filter(
    (item) =>
      item.external_id.endsWith(FEATURE.VOLUME_LIMIT_DAY) ||
      item.external_id.endsWith(FEATURE.VOLUME_LIMIT_NIGHT),
  );
  assert.equal(limits.length, 2);
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, DEVICE_POLL_FREQUENCIES.EVERY_MINUTES);
});

test('device external_ids are unique and stable for a platform id', () => {
  seedPlayers();
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys);
  const ids = devices.map((device) => device.external_id);
  assert.equal(new Set(ids).size, ids.length);
  const again = DEVICE_BLUEPRINTS[0].deviceExternalId(gladys, 'player-1');
  assert.equal(again, devices[0].external_id);
});

test('findBlueprintByDevice routes a player and ignores anything else', () => {
  seedPlayers();
  const gladys = createFakeGladys();
  const externalId = DEVICE_BLUEPRINTS[0].deviceExternalId(gladys, 'player-1');
  assert.equal(findBlueprintByDevice(gladys, { external_id: externalId }), DEVICE_BLUEPRINTS[0]);
  assert.equal(findBlueprintByDevice(gladys, { external_id: 'does-not-exist' }), undefined);
});

test('the poller reads a player at the refresh interval of the config', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  seedPlayers();
  const gladys = createFakeGladys();
  const pollDevice = createPoller();
  const player = { external_id: DEVICE_BLUEPRINTS[0].deviceExternalId(gladys, 'player-1') };
  const everyFiveMinutes = normalizeConfig({ access_token: 'secret-token', poll_frequency: 300 });
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ device: { config: {}, status: { batteryLevelPercentage: 10 } } }),
  }));

  assert.equal(await pollDevice(gladys, player, everyFiveMinutes), true);
  for (let minute = 1; minute < 5; minute += 1) {
    t.mock.timers.tick(DEVICE_POLL_FREQUENCIES.EVERY_MINUTES);
    assert.equal(
      await pollDevice(gladys, player, everyFiveMinutes),
      false,
      `skipped at ${minute} min`,
    );
  }
  t.mock.timers.tick(DEVICE_POLL_FREQUENCIES.EVERY_MINUTES - 50);
  assert.equal(await pollDevice(gladys, player, everyFiveMinutes), true);
});

test('the poller retries a failed read at the next poll', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  seedPlayers();
  const gladys = createFakeGladys();
  const pollDevice = createPoller();
  const player = { external_id: DEVICE_BLUEPRINTS[0].deviceExternalId(gladys, 'player-1') };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('network down');
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ device: { config: {}, status: { batteryLevelPercentage: 42 } } }),
    };
  });

  await assert.rejects(pollDevice(gladys, player, config), /network down/);
  t.mock.timers.tick(DEVICE_POLL_FREQUENCIES.EVERY_MINUTES);
  assert.equal(await pollDevice(gladys, player, config), true);
  const batteryId = gladys.externalIds('yoto-player', 'player-1').feature(FEATURE.BATTERY);
  assert.equal(gladys.fake.lastState(batteryId), 42);
});

test('the poller ignores a device that has nothing to poll', async () => {
  const gladys = createFakeGladys();
  const pollDevice = createPoller();
  assert.equal(await pollDevice(gladys, { external_id: 'does-not-exist' }, config), false);
});

test('test_connection reports how many players the token can see', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ devices: [{ deviceId: 'player-1', name: 'Chambre' }] }),
  }));
  const message = await DEVICE_BLUEPRINTS[0].actions.test_connection(gladys, {
    fields: {},
    config,
  });
  assert.match(message.en, /1 Yoto player/);
  assert.match(message.fr, /1 lecteur/);
});
