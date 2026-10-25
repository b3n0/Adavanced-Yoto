import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { normalizeConfig } from '../src/config.js';
import { resetPlayerRuntime } from '../src/devices/yotoPlayer.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

test('play_card posts the card and returns the declared output', async (t) => {
  resetPlayerRuntime();
  const gladys = createFakeGladys();
  const config = normalizeConfig({ access_token: 'secret-token' });
  const deviceId = DEVICE_BLUEPRINTS[0].deviceExternalId(gladys, 'player-1');
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  };

  const outputs = await SCENE_ACTIONS.play_card(gladys, {
    fields: { device: deviceId, card_id: '5WsQg', track_index: 0 },
    config,
  });

  assert.deepEqual(outputs, { playing: true });
  const declared = keysOf(
    manifest.scene_actions.find((entry) => entry.key === 'play_card').outputs,
  );
  for (const key of Object.keys(outputs)) {
    assert.ok(declared.includes(key), `output "${key}" is not declared`);
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/device-v2\/player-1\/command\/card\/start$/);
  assert.deepEqual(calls[0].body, {
    uri: 'https://yoto.io/5WsQg',
    chapterKey: '01',
    trackKey: '01',
  });
  assert.equal(calls[0].url.includes('secret-token'), false);
});

test('play_card refuses a device that is not a Yoto player', async () => {
  const gladys = createFakeGladys();
  await assert.rejects(
    () =>
      SCENE_ACTIONS.play_card(gladys, {
        fields: { device: 'not-a-player', card_id: '5WsQg' },
        config: normalizeConfig({ access_token: 'secret-token' }),
      }),
    /Yoto player/,
  );
});
