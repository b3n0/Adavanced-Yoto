import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  YotoAuthError,
  YotoClient,
  percentToVolumeStep,
  volumeStepToPercent,
} from '../src/yoto-client.js';

const TOKEN = 'super-secret-token';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
  };
}

test('volume steps map onto the Yoto percent scale', () => {
  assert.equal(volumeStepToPercent(0), 0);
  assert.equal(volumeStepToPercent(8), 50);
  assert.equal(volumeStepToPercent(16), 100);
  assert.equal(percentToVolumeStep(50), 8);
  assert.equal(percentToVolumeStep(100), 16);
});

test('every request sends the bearer token and never puts it in the URL', async () => {
  const client = new YotoClient(TOKEN, async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(String(url).includes(TOKEN), false);
    assert.match(String(url), /^https:\/\/api\.yotoplay\.com\/device-v2\/devices\/mine$/);
    return jsonResponse({ devices: [] });
  });
  assert.deepEqual(await client.listDevices(), { devices: [] });
});

test('a rejected token raises an auth error that does not contain the token', async () => {
  const client = new YotoClient(TOKEN, async () =>
    jsonResponse({ error: { code: 'unauthorized' } }, 401),
  );
  await assert.rejects(client.listDevices(), (err) => {
    assert.ok(err instanceof YotoAuthError);
    assert.equal(JSON.stringify(err).includes(TOKEN), false);
    assert.equal(err.status, 401);
    return true;
  });
});

test('an empty token does not call the network', async () => {
  let called = false;
  const client = new YotoClient('   ', async () => {
    called = true;
    return jsonResponse({});
  });
  await assert.rejects(client.listDevices(), YotoAuthError);
  assert.equal(called, false);
});

test('updateSettings merges onto the current config', async () => {
  const calls = [];
  const client = new YotoClient(TOKEN, async (url, init) => {
    calls.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (init.method === 'GET') {
      return jsonResponse({
        device: { config: { alarms: ['keep-me'], maxVolumeLimit: '4', ambientColour: '#112233' } },
      });
    }
    return jsonResponse({ status: 'ok' });
  });

  await client.updateSettings('player-1', { maxVolumeLimit: '8' });

  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /\/device-v2\/player-1\/config$/);
  assert.deepEqual(calls[1].body.config, {
    alarms: ['keep-me'],
    maxVolumeLimit: '8',
    ambientColour: '#112233',
  });
});

test('playCard sends the first track when the index is 0', async () => {
  let body;
  const client = new YotoClient(TOKEN, async (_url, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ status: 'ok' });
  });
  await client.playCard('player-1', '5WsQg', 0);
  assert.deepEqual(body, { uri: 'https://yoto.io/5WsQg', chapterKey: '01', trackKey: '01' });
});
