import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildPlayerContent, buildPlayersContent } from '../src/widgets.js';

test('the players widget lists what the last poll saw', () => {
  const content = buildPlayersContent(
    [{ deviceId: 'abc', name: 'Chambre' }],
    new Map([
      [
        'abc',
        {
          batteryLevel: 18,
          charging: false,
          volume: 40,
          playing: true,
          cardTitle: 'Histoires',
          online: true,
          deviceTemperature: 36,
          ambientLight: 12,
          wifiStrength: -70,
          nightLight: true,
        },
      ],
    ]),
  );
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].items[0].title, 'Chambre');
  assert.equal(content.components[0].items[0].subtitle, 'Histoires');
  assert.equal(content.components[0].items[0].badge.text, '18 %');
});

test('the player widget binds its tiles to the player features', () => {
  const gladys = createFakeGladys();
  const content = buildPlayerContent(gladys, { deviceId: 'abc', name: 'Chambre' }, undefined);
  assert.deepEqual(validateWidgetContent(content), []);
  const battery = content.components.find((item) => item.icon === 'battery');
  assert.equal(battery.device_feature, gladys.externalIds('yoto-player', 'abc').feature('battery'));
});

test('an empty account and a missing player stay valid widget contents', () => {
  assert.deepEqual(validateWidgetContent(buildPlayersContent([], new Map())), []);
  assert.deepEqual(validateWidgetContent(buildPlayerContent({}, null, undefined)), []);
});
