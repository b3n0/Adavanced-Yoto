import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCharging, isPlaying, parseStatus, parseTemperaturePair } from '../src/yoto-status.js';

test('parseStatus keeps a missing reading null and reads the firmware keys', () => {
  const status = parseStatus({
    batteryLevel: 41,
    charging: 0,
    powerSrc: 1,
    userVolume: 57,
    cardInserted: 2,
    activeCard: '5WsQg',
    als: 120,
    temp: '0:36',
    wifiStrength: -62,
  });
  assert.equal(status.batteryLevel, 41);
  assert.equal(status.volume, 57);
  assert.equal(status.cardInserted, 2);
  assert.equal(status.activeCard, '5WsQg');
  assert.equal(status.ambientLight, 120);
  assert.equal(status.deviceTemperature, 36);
  assert.equal(status.wifiStrength, -62);
  assert.equal(isCharging(status), true);
  assert.equal(isPlaying(status), true);
});

test('a full battery on the dock still counts as plugged in', () => {
  const status = parseStatus({ charging: 0, powerSrc: 2 });
  assert.equal(isCharging(status), true);
});

test('temperature 0 and notSupported are unknown, not 0 °C', () => {
  assert.deepEqual(parseTemperaturePair('0:notSupported'), {
    batteryTemperature: null,
    deviceTemperature: null,
  });
  assert.equal(parseStatus({ temp: '31:0' }).deviceTemperature, null);
});

test('an empty card id and the firmware sentinel none are not a card', () => {
  assert.equal(parseStatus({ activeCard: 'none' }).activeCard, null);
  assert.equal(parseStatus({ cardInserted: 0 }).cardInserted, 0);
  assert.equal(isPlaying(parseStatus({})), null);
});
