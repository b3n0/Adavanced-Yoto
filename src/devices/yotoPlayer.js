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
//   - the three volume features stay on the player's 0–16 knob. Live volume
//     is converted to the percent the command API expects; the day/night
//     limits are stored as those steps.
// Card playback is not a feature: a card id is a string, and Gladys feature
// state is numeric. Scenes send it through the `play_card` action.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import {
  hexToInt,
  hexToRgb,
  intToHex,
  isOffColor,
  percentToVolumeStep,
  volumeStepToPercent,
  YotoClient,
} from '../yoto-client.js';

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
};

const VOLUME_MIN = 0;
const VOLUME_MAX = 16;

let knownPlayers = [];
const runtimeByDevice = new Map();

export function resetPlayerRuntime() {
  knownPlayers = [];
  runtimeByDevice.clear();
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
          min: VOLUME_MIN,
          max: VOLUME_MAX,
          keepHistory: false,
        }),
        feature(ids, {
          name: 'Volume max jour',
          key: FEATURE.VOLUME_LIMIT_DAY,
          category: DEVICE_FEATURE_CATEGORIES.MUSIC,
          type: DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
          min: VOLUME_MIN,
          max: VOLUME_MAX,
          keepHistory: false,
        }),
        feature(ids, {
          name: 'Volume max nuit',
          key: FEATURE.VOLUME_LIMIT_NIGHT,
          category: DEVICE_FEATURE_CATEGORIES.MUSIC,
          type: DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
          min: VOLUME_MIN,
          max: VOLUME_MAX,
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
  },

  async onPoll(gladys, { device, config, session }) {
    const deviceId = requiredDeviceId(device);
    const body = await new YotoClient(session ?? config.access_token).getConfig(deviceId);
    const runtime = absorbSnapshot(deviceId, body);
    const states = statesFromRuntime(gladys, deviceId, runtime);
    if (states.length > 0) {
      await gladys.publishStates(states);
    }
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
      const step = clamp(value, VOLUME_MIN, VOLUME_MAX);
      await client.setVolume(deviceId, volumeStepToPercent(step));
      await gladys.publishState(feature.external_id, step);
      return;
    }

    if (key === FEATURE.VOLUME_LIMIT_DAY || key === FEATURE.VOLUME_LIMIT_NIGHT) {
      const step = clamp(value, VOLUME_MIN, VOLUME_MAX);
      const field = key === FEATURE.VOLUME_LIMIT_DAY ? 'maxVolumeLimit' : 'nightMaxVolumeLimit';
      await client.updateSettings(deviceId, { [field]: String(step) });
      if (key === FEATURE.VOLUME_LIMIT_DAY) {
        runtime.dayVolumeLimit = step;
      } else {
        runtime.nightVolumeLimit = step;
      }
      await gladys.publishState(feature.external_id, step);
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
      volumeStep: null,
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
  runtime.day = readDay(status, runtime.day);
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
    runtime.dayVolumeLimit = dayLimit;
  }
  if (nightLimit != null) {
    runtime.nightVolumeLimit = nightLimit;
  }
  runtime.battery = clampOptional(
    firstNumber(status.batteryLevelPercentage, status.batteryLevel, status.battery),
    0,
    100,
  );
  const volumePercent = firstNumber(status.userVolumePercentage, status.userVolume, status.volume);
  runtime.volumeStep = volumePercent == null ? null : percentToVolumeStep(volumePercent);
  return runtime;
}

function statesFromRuntime(gladys, deviceId, runtime) {
  const ids = gladys.externalIds(DEVICE_TYPE, deviceId);
  const activeColor = runtime.day ? runtime.dayColor : runtime.nightColor;
  const activeBrightness = runtime.day ? runtime.dayBrightness : runtime.nightBrightness;
  const states = [];
  const push = (key, state) => {
    if (state == null) {
      return;
    }
    states.push({ device_feature_external_id: ids.feature(key), state });
  };
  if (activeColor != null) {
    push(FEATURE.NIGHTLIGHT, isOffColor(activeColor) ? 0 : 1);
    push(FEATURE.COLOR, hexToInt(activeColor));
  }
  push(FEATURE.BRIGHTNESS, activeBrightness);
  push(FEATURE.VOLUME, runtime.volumeStep);
  push(FEATURE.VOLUME_LIMIT_DAY, runtime.dayVolumeLimit);
  push(FEATURE.VOLUME_LIMIT_NIGHT, runtime.nightVolumeLimit);
  push(FEATURE.BATTERY, runtime.battery);
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
  return clampOptional(firstNumber(value), VOLUME_MIN, VOLUME_MAX);
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
