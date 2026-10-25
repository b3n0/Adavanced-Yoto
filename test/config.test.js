import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims credentials and coerces the poll interval', () => {
  const config = normalizeConfig({
    client_id: '  app  ',
    client_secret: '  secret  ',
    access_token: '  abc  ',
    refresh_token: '  refresh  ',
    poll_frequency: '600',
    token_expires_at: '1700000000000',
  });
  assert.equal(config.client_id, 'app');
  assert.equal(config.client_secret, 'secret');
  assert.equal(config.access_token, 'abc');
  assert.equal(config.refresh_token, 'refresh');
  assert.equal(config.token_expires_at, 1700000000000);
  assert.equal(config.poll_frequency, 600);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('normalizeConfig falls back when the token or the interval is missing', () => {
  const config = normalizeConfig({});
  assert.equal(config.access_token, '');
  assert.equal(config.refresh_token, '');
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
});

test('normalizeConfig drops a non-string token', () => {
  assert.equal(normalizeConfig({ access_token: 12, client_secret: 4 }).access_token, '');
  assert.equal(normalizeConfig({ client_secret: 4 }).client_secret, '');
});
