import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FEATURE, resetPlayerRuntime, yotoPlayer } from '../src/devices/yotoPlayer.js';
import { normalizeConfig } from '../src/config.js';

const TOKEN = 'super-secret-token';
const config = normalizeConfig({ access_token: TOKEN, request_status_push: false });

function playerFixture(gladys) {
  return {
    device: { external_id: gladys.externalIds('yoto-player', 'abc').device },
    feature(key) {
      return { external_id: gladys.externalIds('yoto-player', 'abc').feature(key) };
    },
  };
}

const CONFIG_BODY = {
  device: {
    deviceId: 'abc',
    config: {
      alarms: ['keep-me'],
      maxVolumeLimit: '4',
      nightMaxVolumeLimit: '2',
      ambientColour: '#112233',
      nightAmbientColour: '#445566',
      dayDisplayBrightness: '40',
      nightDisplayBrightness: 'auto',
    },
    status: {
      batteryLevelPercentage: 77,
      userVolume: 50,
      day: false,
    },
  },
};

test('polling publishes battery, the volume percent and the active night light', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  const player = playerFixture(gladys);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(CONFIG_BODY),
  }));

  await yotoPlayer.onPoll(gladys, { device: player.device, config });

  const ids = gladys.externalIds('yoto-player', 'abc');
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.BATTERY)), 77);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.VOLUME)), 50);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.NIGHTLIGHT)), 1);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.VOLUME_LIMIT_DAY)), 25);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.VOLUME_LIMIT_NIGHT)), 13);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.BRIGHTNESS)), 100);
});

test('setting the volume posts the matching percent', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  const player = playerFixture(gladys);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  });

  const feature = player.feature(FEATURE.VOLUME);
  await yotoPlayer.onSetValue(gladys, { device: player.device, feature, value: 50, config });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/command\/volume\/set$/);
  assert.deepEqual(calls[0].body, { volume: 50 });
  assert.equal(gladys.fake.lastState(feature.external_id), 50);
  assert.equal(calls[0].url.includes(TOKEN), false);
});

test('the day volume limit is merged into maxVolumeLimit', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  const player = playerFixture(gladys);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (!init.method || init.method === 'GET') {
      return { ok: true, status: 200, text: async () => JSON.stringify(CONFIG_BODY) };
    }
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  });

  const feature = player.feature(FEATURE.VOLUME_LIMIT_DAY);
  await yotoPlayer.onSetValue(gladys, { device: player.device, feature, value: 50, config });

  const put = calls.find((call) => call.method === 'PUT');
  assert.equal(put.body.config.maxVolumeLimit, '8');
  assert.deepEqual(put.body.config.alarms, ['keep-me']);
  assert.equal(put.body.config.nightMaxVolumeLimit, '2');
  assert.equal(gladys.fake.lastState(feature.external_id), 50);
});

test('a colour writes the night profile and the live ring when the player is in night mode', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  const player = playerFixture(gladys);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (!init.method || init.method === 'GET') {
      return { ok: true, status: 200, text: async () => JSON.stringify(CONFIG_BODY) };
    }
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  });

  // Seed the day/night flag from a poll, then set green (#00ff00 = 65280).
  await yotoPlayer.onPoll(gladys, { device: player.device, config });
  const feature = player.feature(FEATURE.COLOR);
  await yotoPlayer.onSetValue(gladys, { device: player.device, feature, value: 65280, config });

  const put = calls.filter((call) => call.method === 'PUT').at(-1);
  assert.equal(put.body.config.nightAmbientColour, '#00ff00');
  assert.equal(put.body.config.ambientColour, '#112233');
  const ambient = calls.find((call) => call.url.endsWith('/command/ambients/set'));
  assert.deepEqual(ambient.body, { r: 0, g: 255, b: 0 });
  assert.equal(gladys.fake.lastState(feature.external_id), 65280);
  assert.equal(gladys.fake.lastState(player.feature(FEATURE.NIGHTLIGHT).external_id), 1);
});

test('switching the night light off stores the Yoto off sentinel', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  const player = playerFixture(gladys);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (!init.method || init.method === 'GET') {
      return { ok: true, status: 200, text: async () => JSON.stringify(CONFIG_BODY) };
    }
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  });

  await yotoPlayer.onPoll(gladys, { device: player.device, config });
  await yotoPlayer.onSetValue(gladys, {
    device: player.device,
    feature: player.feature(FEATURE.NIGHTLIGHT),
    value: 0,
    config,
  });

  const put = calls.filter((call) => call.method === 'PUT').at(-1);
  assert.equal(put.body.config.nightAmbientColour, '#0');
  const ambient = calls.filter((call) => call.url.endsWith('/command/ambients/set')).at(-1);
  assert.deepEqual(ambient.body, { r: 0, g: 0, b: 0 });
  assert.equal(gladys.fake.lastState(player.feature(FEATURE.NIGHTLIGHT).external_id), 0);
});
