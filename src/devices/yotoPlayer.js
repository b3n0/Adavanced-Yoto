// -----------------------------------------------------------------------------
// Device type: YOTO PLAYER
//
// One Gladys device per player returned by the Yoto account. The platform id
// is the Yoto deviceId (stable cloud id), never the name the family gave it.
//
// The ring is an RGB command plus a stored day/night colour. Gladys models a
// lamp as switch + color integer + brightness, so:
//   - switch and color write the active profile's ambient colour (`#0` is the
//     app's "ring off" sentinel) and push the same RGB live;
//   - brightness writes the active profile's display brightness (the only
//     0–100 level Yoto stores; the ring itself has no separate dimmer);
//   - volume is the percent Gladys shows (0–100). The command API already
//     speaks percents. The day/night limits are stored on the player as the
//     0–16 knob step, and converted at this boundary.
// Card playback is not a feature: a card id is a string. Scenes send it
// through the `play_card` action. The title, the author and the cover are
// read-only music features (Gladys 5.3). Sensors are read-only too.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { detectSceneEvents, nextBatteryLowLatch } from '../scene-events.js';
import { SCENE_TRIGGER, WIDGET } from '../surfaces.js';
import {
  hexToInt,
  hexToRgb,
  intToHex,
  isOffColor,
  percentToVolumeStep,
  volumeStepToPercent,
  YotoClient,
} from '../yoto-client.js';
import { isCharging, isPlaying, parseStatus } from '../yoto-status.js';

export const DEVICE_TYPE = 'yoto-player';

const logger = createLogger({ name: DEVICE_TYPE });

export const FEATURE = {
  NIGHTLIGHT: 'nightlight',
  COLOR: 'nightlight-color',
  BRIGHTNESS: 'nightlight-brightness',
  VOLUME: 'volume',
  VOLUME_LIMIT_DAY: 'volume-limit-day',
  VOLUME_LIMIT_NIGHT: 'volume-limit-night',
  BATTERY: 'battery',
  CHARGING: 'charging',
  PLAYING: 'playing',
  CARD: 'card',
  AMBIENT_LIGHT: 'ambient-light',
  TEMPERATURE: 'temperature',
  WIFI: 'wifi',
  ONLINE: 'online',
  TITLE: 'title',
  ARTIST: 'artist',
  ARTWORK: 'artwork',
};

// The day/night limits are stored on the player as this knob step.
const VOLUME_STEP_MIN = 0;
const VOLUME_STEP_MAX = 16;
const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

// Ask the player to report, then wait for the cloud to store the answer.
// Read at once, the shadow still holds the previous report.
const STATUS_PUSH_SETTLE_MS = 1000;

// A card Yoto failed to describe is asked again after this delay.
const CARD_RETRY_MS = 10 * 60 * 1000;

// Unchanged values are still sent once an hour, so Gladys does not mark a
// stable feature (online, the volume) as stale. The host allows 300 states
// a minute, which a full snapshot of every player would burn.
const STATE_HEARTBEAT_MS = 60 * 60 * 1000;

let knownPlayers = [];
const runtimeByDevice = new Map();
const snapshots = new Map();
const cards = new Map();

export function resetPlayerRuntime() {
  knownPlayers = [];
  runtimeByDevice.clear();
  snapshots.clear();
  cards.clear();
}

export function getSnapshot(deviceId) {
  return snapshots.get(deviceId);
}

export function getSnapshots() {
  return snapshots;
}

export function setKnownPlayers(players) {
  knownPlayers = players.map((player) => ({
    deviceId: String(player.deviceId),
    name: player.name || 'Yoto Player',
  }));
}

export function getKnownPlayers() {
  return knownPlayers;
}

export async function discoverPlayers(client) {
  setKnownPlayers(parseDeviceList(await client.listDevices()));
  return knownPlayers;
}

export function platformIdFromExternalId(externalId) {
  const marker = `:${DEVICE_TYPE}:`;
  const index = String(externalId ?? '').lastIndexOf(marker);
  if (index === -1) {
    return null;
  }
  const rest = String(externalId).slice(index + marker.length);
  const separator = rest.indexOf(':');
  const platformId = separator === -1 ? rest : rest.slice(0, separator);
  return platformId || null;
}

export const yotoPlayer = {
  key: DEVICE_TYPE,
  sceneTriggers: Object.values(SCENE_TRIGGER),

  deviceExternalId(gladys, platformId) {
    return gladys.externalIds(DEVICE_TYPE, platformId).device;
  },

  ownsDevice(gladys, device) {
    const platformId = platformIdFromExternalId(device?.external_id);
    if (!platformId) {
      return false;
    }
    return device.external_id === gladys.externalIds(DEVICE_TYPE, platformId).device;
  },

  buildDevice(gladys, player) {
    const ids = gladys.externalIds(DEVICE_TYPE, player.deviceId);
    return {
      name: player.name || 'Yoto Player',
      external_id: ids.device,
      should_poll: true,
      poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
      features: [
        feature(ids, {
          name: 'Veilleuse',
          key: FEATURE.NIGHTLIGHT,
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
          min: 0,
          max: 1,
        }),
        feature(ids, {
          name: 'Couleur de la veilleuse',
          key: FEATURE.COLOR,
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.COLOR,
          // Gladys rejects a feature whose min or max is null. A colour is the
          // 24-bit integer 0x000000–0xffffff.
          min: 0,
          max: 0xffffff,
        }),
        feature(ids, {
          name: 'Luminosité de la veilleuse',
          key: FEATURE.BRIGHTNESS,
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
        }),
        feature(ids, {
          name: 'Volume',
          key: FEATURE.VOLUME,
          category: DEVICE_FEATURE_CATEGORIES.MUSIC,
          type: DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: PERCENT_MIN,
          max: PERCENT_MAX,
          keepHistory: false,
        }),
        feature(ids, {
          name: 'Volume max jour',
          key: FEATURE.VOLUME_LIMIT_DAY,
          category: DEVICE_FEATURE_CATEGORIES.MUSIC,
          type: DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: PERCENT_MIN,
          max: PERCENT_MAX,
          keepHistory: false,
        }),
        feature(ids, {
          name: 'Volume max nuit',
          key: FEATURE.VOLUME_LIMIT_NIGHT,
          category: DEVICE_FEATURE_CATEGORIES.MUSIC,
          type: DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: PERCENT_MIN,
          max: PERCENT_MAX,
          keepHistory: false,
        }),
        feature(ids, {
          name: 'Batterie',
          key: FEATURE.BATTERY,
          category: DEVICE_FEATURE_CATEGORIES.BATTERY,
          type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
          readOnly: true,
          hasFeedback: false,
        }),
        // Not the battery category: Gladys' weekly battery check reads every
        // feature of that category as a percentage, so a plugged player (1)
        // would raise "battery under 10 %".
        feature(ids, {
          name: 'En charge',
          key: FEATURE.CHARGING,
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.INPUT.BINARY,
          min: 0,
          max: 1,
          readOnly: true,
          hasFeedback: false,
        }),
        feature(ids, {
          name: 'Lecture',
          key: FEATURE.PLAYING,
          category: DEVICE_FEATURE_CATEGORIES.MUSIC,
          type: DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE,
          min: 0,
          max: 1,
          readOnly: true,
          hasFeedback: false,
        }),
        feature(ids, {
          name: 'Carte en cours',
          key: FEATURE.CARD,
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          // Gladys stores min and max as NOT NULL on every feature, text
          // included. The value is a string, so 0/0 is the neutral pair.
          min: 0,
          max: 0,
          readOnly: true,
          hasFeedback: false,
        }),
        feature(ids, {
          name: 'Lumière ambiante',
          key: FEATURE.AMBIENT_LIGHT,
          category: DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.LUX,
          min: 0,
          max: 1000,
          readOnly: true,
          hasFeedback: false,
        }),
        feature(ids, {
          name: 'Température',
          key: FEATURE.TEMPERATURE,
          category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
          unit: DEVICE_FEATURE_UNITS.CELSIUS,
          min: -10,
          max: 90,
          readOnly: true,
          hasFeedback: false,
        }),
        feature(ids, {
          name: 'Signal Wi-Fi',
          key: FEATURE.WIFI,
          category: DEVICE_FEATURE_CATEGORIES.SIGNAL,
          type: DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
          min: -100,
          max: 0,
          readOnly: true,
          hasFeedback: false,
        }),
        feature(ids, {
          name: 'En ligne',
          key: FEATURE.ONLINE,
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.INPUT.BINARY,
          min: 0,
          max: 1,
          readOnly: true,
          hasFeedback: false,
        }),
        musicText(ids, 'Titre', FEATURE.TITLE, DEVICE_FEATURE_TYPES.MUSIC.TITLE),
        musicText(ids, 'Auteur', FEATURE.ARTIST, DEVICE_FEATURE_TYPES.MUSIC.ARTIST),
        musicText(ids, 'Pochette', FEATURE.ARTWORK, DEVICE_FEATURE_TYPES.MUSIC.ARTWORK),
      ],
    };
  },

  actions: {
    async test_connection(_gladys, { config, session }) {
      const players = await discoverPlayers(new YotoClient(session ?? config.access_token));
      return {
        en: `Connected. ${players.length} Yoto player(s) found.`,
        fr: `Connecté. ${players.length} lecteur(s) Yoto trouvé(s).`,
      };
    },
    async refresh_now(gladys, context) {
      const count = await refreshPlayersNow(gladys, context);
      return {
        en: `${count} player(s) refreshed.`,
        fr: `${count} lecteur(s) rafraîchi(s).`,
      };
    },
  },

  async onPoll(gladys, { device, config, session }) {
    const deviceId = requiredDeviceId(device);
    const client = new YotoClient(session ?? config.access_token);
    if (config.request_status_push) {
      try {
        await client.requestStatusPush(deviceId);
        await delay(STATUS_PUSH_SETTLE_MS);
      } catch (err) {
        // The player may be asleep, or the app may lack the control scope.
        // The last status it reported is still readable.
        logger.debug(`Status request refused for ${deviceId}: ${err.message}`);
      }
    }
    const body = await client.getConfig(deviceId);
    const runtime = absorbSnapshot(deviceId, body);
    const playing = runtime.playing === true;
    const card = playing ? await resolveCard(client, runtime.cardId) : null;
    const cardTitle = card === null ? null : (card.title ?? runtime.cardId);
    const states = statesFromRuntime(gladys, deviceId, runtime, playing ? cardTitle : null);
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
    const ids = gladys.externalIds(DEVICE_TYPE, deviceId);
    await gladys.publishNowPlaying(ids.device, nowPlayingOf(playing ? card : null, cardTitle), {
      featureExternalIds: {
        [DEVICE_FEATURE_TYPES.MUSIC.TITLE]: ids.feature(FEATURE.TITLE),
        [DEVICE_FEATURE_TYPES.MUSIC.ARTIST]: ids.feature(FEATURE.ARTIST),
        [DEVICE_FEATURE_TYPES.MUSIC.ARTWORK]: ids.feature(FEATURE.ARTWORK),
      },
    });
    await rememberSnapshot(gladys, deviceId, runtime, playing ? cardTitle : null);
  },

  async onSetValue(gladys, { device, feature, value, config, session }) {
    const deviceId = requiredDeviceId(device);
    const key = featureKey(gladys, deviceId, feature.external_id);
    if (!key) {
      throw new Error(`Unknown feature: ${feature.external_id}`);
    }
    const client = new YotoClient(session ?? config.access_token);
    const runtime = runtimeOf(deviceId);

    if (key === FEATURE.VOLUME) {
      const percent = clamp(value, PERCENT_MIN, PERCENT_MAX);
      await client.setVolume(deviceId, percent);
      runtime.volume = percent;
      await gladys.publishState(feature.external_id, percent);
      return;
    }

    if (key === FEATURE.VOLUME_LIMIT_DAY || key === FEATURE.VOLUME_LIMIT_NIGHT) {
      const step = percentToVolumeStep(clamp(value, PERCENT_MIN, PERCENT_MAX));
      const shown = volumeStepToPercent(step);
      const field = key === FEATURE.VOLUME_LIMIT_DAY ? 'maxVolumeLimit' : 'nightMaxVolumeLimit';
      await client.updateSettings(deviceId, { [field]: String(step) });
      if (key === FEATURE.VOLUME_LIMIT_DAY) {
        runtime.dayVolumeLimit = shown;
      } else {
        runtime.nightVolumeLimit = shown;
      }
      await gladys.publishState(feature.external_id, shown);
      return;
    }

    if (key === FEATURE.BRIGHTNESS) {
      const level = clamp(value, 0, 100);
      const field = runtime.day ? 'dayDisplayBrightness' : 'nightDisplayBrightness';
      await client.updateSettings(deviceId, { [field]: String(level) });
      if (runtime.day) {
        runtime.dayBrightness = level;
      } else {
        runtime.nightBrightness = level;
      }
      await gladys.publishState(feature.external_id, level);
      return;
    }

    if (key === FEATURE.NIGHTLIGHT || key === FEATURE.COLOR) {
      const stored =
        key === FEATURE.NIGHTLIGHT ? colorForSwitch(runtime, value) : colorForPicker(value);
      rememberColor(runtime, stored);
      const field = runtime.day ? 'ambientColour' : 'nightAmbientColour';
      await client.updateSettings(deviceId, { [field]: stored });
      const rgb = hexToRgb(stored);
      await client.setAmbient(deviceId, rgb.r, rgb.g, rgb.b);
      const ids = gladys.externalIds(DEVICE_TYPE, deviceId);
      await gladys.publishState(ids.feature(FEATURE.NIGHTLIGHT), isOffColor(stored) ? 0 : 1);
      await gladys.publishState(ids.feature(FEATURE.COLOR), hexToInt(stored));
      return;
    }

    logger.warn(`Feature ${key} is read-only`);
  },
};

function musicText(ids, name, key, type) {
  return feature(ids, {
    name,
    key,
    category: DEVICE_FEATURE_CATEGORIES.MUSIC,
    type,
    min: 0,
    max: 0,
    readOnly: true,
    hasFeedback: false,
    keepHistory: false,
  });
}

function feature(ids, spec) {
  return {
    name: spec.name,
    external_id: ids.feature(spec.key),
    category: spec.category,
    type: spec.type,
    ...(spec.unit ? { unit: spec.unit } : {}),
    ...(spec.min !== undefined ? { min: spec.min, max: spec.max } : {}),
    read_only: spec.readOnly === true,
    has_feedback: spec.hasFeedback !== false,
    keep_history: spec.keepHistory !== false,
  };
}

function parseDeviceList(body) {
  const items = Array.isArray(body?.devices) ? body.devices : [];
  return items
    .filter((item) => item && typeof item.deviceId === 'string' && item.deviceId)
    .map((item) => ({
      deviceId: item.deviceId,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Yoto Player',
    }));
}

function requiredDeviceId(device) {
  const deviceId = platformIdFromExternalId(device?.external_id);
  if (!deviceId) {
    throw new Error('Not a Yoto player');
  }
  return deviceId;
}

function featureKey(gladys, deviceId, featureExternalId) {
  const ids = gladys.externalIds(DEVICE_TYPE, deviceId);
  for (const key of Object.values(FEATURE)) {
    if (ids.feature(key) === featureExternalId) {
      return key;
    }
  }
  return null;
}

function runtimeOf(deviceId) {
  let runtime = runtimeByDevice.get(deviceId);
  if (!runtime) {
    // Night until the first status says otherwise: a colour written before
    // the first poll must not overwrite the day profile by accident.
    runtime = {
      day: false,
      dayColor: null,
      nightColor: null,
      dayColorOn: '#ffffff',
      nightColorOn: '#ffffff',
      dayBrightness: null,
      nightBrightness: null,
      dayVolumeLimit: null,
      nightVolumeLimit: null,
      battery: null,
      volume: null,
      charging: null,
      playing: null,
      cardId: null,
      ambientLight: null,
      temperature: null,
      wifi: null,
      online: null,
    };
    runtimeByDevice.set(deviceId, runtime);
  }
  return runtime;
}

function absorbSnapshot(deviceId, body) {
  const device = body?.device ?? {};
  const config = device.config ?? {};
  const status = device.status ?? {};
  const runtime = runtimeOf(deviceId);
  const parsed = parseStatus(status);
  runtime.day = readDay(status, runtime.day);
  runtime.online = typeof device.online === 'boolean' ? device.online : null;
  runtime.battery = parsed.batteryLevel;
  runtime.volume = parsed.volume;
  runtime.charging = isCharging(parsed);
  runtime.playing = isPlaying(parsed);
  runtime.cardId = parsed.activeCard;
  runtime.ambientLight = parsed.ambientLight;
  runtime.temperature = parsed.deviceTemperature;
  runtime.wifi = parsed.wifiStrength;
  if (config.ambientColour != null) {
    runtime.dayColor = String(config.ambientColour);
    if (!isOffColor(runtime.dayColor)) {
      runtime.dayColorOn = normalizeOnColor(runtime.dayColor);
    }
  }
  if (config.nightAmbientColour != null) {
    runtime.nightColor = String(config.nightAmbientColour);
    if (!isOffColor(runtime.nightColor)) {
      runtime.nightColorOn = normalizeOnColor(runtime.nightColor);
    }
  }
  const dayBrightness = parseBrightness(config.dayDisplayBrightness);
  const nightBrightness = parseBrightness(config.nightDisplayBrightness);
  if (dayBrightness != null) {
    runtime.dayBrightness = dayBrightness;
  }
  if (nightBrightness != null) {
    runtime.nightBrightness = nightBrightness;
  }
  const dayLimit = parseVolumeLimit(config.maxVolumeLimit);
  const nightLimit = parseVolumeLimit(config.nightMaxVolumeLimit);
  if (dayLimit != null) {
    runtime.dayVolumeLimit = volumeStepToPercent(dayLimit);
  }
  if (nightLimit != null) {
    runtime.nightVolumeLimit = volumeStepToPercent(nightLimit);
  }
  return runtime;
}

function statesFromRuntime(gladys, deviceId, runtime, cardTitle) {
  const ids = gladys.externalIds(DEVICE_TYPE, deviceId);
  const activeColor = runtime.day ? runtime.dayColor : runtime.nightColor;
  const activeBrightness = runtime.day ? runtime.dayBrightness : runtime.nightBrightness;
  const states = [];
  const push = (key, state) => {
    if (state == null || !Number.isFinite(state)) {
      return;
    }
    states.push({ device_feature_external_id: ids.feature(key), state });
  };
  if (activeColor != null) {
    push(FEATURE.NIGHTLIGHT, isOffColor(activeColor) ? 0 : 1);
    push(FEATURE.COLOR, hexToInt(activeColor));
  }
  push(FEATURE.BRIGHTNESS, activeBrightness);
  push(FEATURE.VOLUME, runtime.volume);
  push(FEATURE.VOLUME_LIMIT_DAY, runtime.dayVolumeLimit);
  push(FEATURE.VOLUME_LIMIT_NIGHT, runtime.nightVolumeLimit);
  push(FEATURE.BATTERY, runtime.battery);
  push(FEATURE.CHARGING, runtime.charging == null ? null : Number(runtime.charging));
  push(FEATURE.PLAYING, runtime.playing == null ? null : Number(runtime.playing));
  push(FEATURE.ONLINE, runtime.online == null ? null : Number(runtime.online));
  push(FEATURE.AMBIENT_LIGHT, runtime.ambientLight);
  push(FEATURE.TEMPERATURE, runtime.temperature);
  push(FEATURE.WIFI, runtime.wifi);
  // An empty string would leave the previous title on screen.
  states.push({
    device_feature_external_id: ids.feature(FEATURE.CARD),
    text: cardTitle ?? '-',
  });
  return states;
}

function colorForSwitch(runtime, value) {
  const on = Number(value) === 1;
  if (!on) {
    return '#0';
  }
  return runtime.day ? runtime.dayColorOn : runtime.nightColorOn;
}

function colorForPicker(value) {
  const hex = intToHex(value);
  return isOffColor(hex) ? '#0' : hex;
}

function rememberColor(runtime, stored) {
  if (isOffColor(stored)) {
    if (runtime.day) {
      runtime.dayColor = stored;
    } else {
      runtime.nightColor = stored;
    }
    return;
  }
  if (runtime.day) {
    runtime.dayColor = stored;
    runtime.dayColorOn = stored;
  } else {
    runtime.nightColor = stored;
    runtime.nightColorOn = stored;
  }
}

function readDay(status, previous) {
  if (typeof status.day === 'boolean') {
    return status.day;
  }
  if (typeof status.dayMode === 'boolean') {
    return status.dayMode;
  }
  return previous;
}

function parseBrightness(value) {
  if (value == null || value === '') {
    return null;
  }
  if (String(value).trim().toLowerCase() === 'auto') {
    return 100;
  }
  return clampOptional(Number(value), 0, 100);
}

function parseVolumeLimit(value) {
  return clampOptional(firstNumber(value), VOLUME_STEP_MIN, VOLUME_STEP_MAX);
}

function normalizeOnColor(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  return match ? `#${match[1].toLowerCase()}` : '#ffffff';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clampOptional(value, min, max) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid value');
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function nowPlayingOf(card, title) {
  if (card === null) {
    return { title: '', artist: '', artwork_url: null };
  }
  return {
    title: title ?? '',
    artist: card.author ?? '',
    artwork_url: card.coverUrl ?? null,
  };
}

async function resolveCard(client, cardId) {
  if (!cardId) {
    return null;
  }
  const now = Date.now();
  const known = cards.get(cardId);
  if (!known || (known.retryAt !== undefined && now >= known.retryAt)) {
    try {
      cards.set(cardId, await client.getCard(cardId));
    } catch (err) {
      logger.debug(`Card unavailable for ${cardId}: ${err.message}`);
      cards.set(cardId, {
        title: null,
        author: null,
        coverUrl: null,
        retryAt: now + CARD_RETRY_MS,
      });
    }
  }
  const card = cards.get(cardId);
  if (!card || card.retryAt !== undefined) {
    return { title: null, author: null, coverUrl: null };
  }
  return card;
}

async function rememberSnapshot(gladys, deviceId, runtime, cardTitle) {
  const ids = gladys.externalIds(DEVICE_TYPE, deviceId);
  const previous = snapshots.get(deviceId);
  const playing = runtime.playing === true;
  const current = {
    deviceId,
    name: knownPlayers.find((player) => player.deviceId === deviceId)?.name || 'Yoto Player',
    online: runtime.online,
    batteryLevel: runtime.battery,
    charging: runtime.charging,
    volume: runtime.volume,
    playing: runtime.playing,
    cardId: playing ? runtime.cardId : null,
    cardTitle: playing ? cardTitle : null,
    ambientLight: runtime.ambientLight,
    deviceTemperature: runtime.temperature,
    wifiStrength: runtime.wifi,
    nightLight: nightLightOf(runtime),
    brightness: runtime.day ? runtime.dayBrightness : runtime.nightBrightness,
  };
  current.batteryLowLatched = nextBatteryLowLatch(previous, current);
  for (const event of detectSceneEvents(previous, current, ids.device)) {
    try {
      await gladys.publishSceneEvent(event.key, event.data);
    } catch (err) {
      // A refused event must not fail the poll: the states are already published.
      logger.warn(`Scene event ${event.key} was refused: ${err.message}`);
    }
  }
  snapshots.set(deviceId, current);
  if (widgetSignature(previous) !== widgetSignature(current)) {
    try {
      gladys.requestWidgetRefresh(WIDGET.PLAYERS);
      gladys.requestWidgetRefresh(WIDGET.PLAYER);
    } catch (err) {
      logger.debug(`Widget refresh nudge failed: ${err.message}`);
    }
  }
}

function nightLightOf(runtime) {
  const color = runtime.day ? runtime.dayColor : runtime.nightColor;
  if (color == null) {
    return null;
  }
  return !isOffColor(color);
}

function widgetSignature(snapshot) {
  if (!snapshot) {
    return '';
  }
  return [
    snapshot.online,
    snapshot.batteryLevel,
    snapshot.charging,
    snapshot.volume,
    snapshot.playing,
    snapshot.cardTitle,
    snapshot.ambientLight,
    snapshot.deviceTemperature,
    snapshot.wifiStrength,
    snapshot.nightLight,
    snapshot.brightness,
  ].join('|');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Read every known player now, ignoring the poll interval. Discovers first
// when the list is still empty (a scene or a widget asked before the startup
// read finished).
export async function refreshPlayersNow(gladys, context) {
  if (knownPlayers.length === 0) {
    await discoverPlayers(new YotoClient(context.session ?? context.config.access_token));
    await gladys.publishDiscoveredDevices(
      knownPlayers.map((player) => yotoPlayer.buildDevice(gladys, player)),
    );
  }
  let count = 0;
  for (const player of knownPlayers) {
    await yotoPlayer.onPoll(gladys, {
      device: { external_id: yotoPlayer.deviceExternalId(gladys, player.deviceId) },
      config: context.config,
      session: context.session,
    });
    count += 1;
  }
  return count;
}
