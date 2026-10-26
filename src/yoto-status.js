// -----------------------------------------------------------------------------
// Translate the raw `device.status` block into the numbers Gladys publishes.
//
// The firmware sends short keys, 0/1 integers where a boolean is meant, and
// a `temp` string that packs two readings. A missing value stays null: publishing
// 0 would look like a real reading (a Yoto Mini has no temperature sensor).
// -----------------------------------------------------------------------------

/**
 * @param {object} raw the `device.status` block of GET /device-v2/{id}/config
 */
export function parseStatus(raw = {}) {
  const { deviceTemperature } = parseTemperaturePair(raw.temp);
  return {
    batteryLevel: clamp(
      firstNumber(raw.batteryLevelPercentage, raw.batteryLevel, raw.battery),
      0,
      100,
    ),
    // `charging` is 1 only while the battery is filling. It drops to 0 on a
    // full battery even when the player is still on its dock.
    isCharging: asBoolean(raw.charging),
    // 0 = battery, 1 = v2 dock, 2 = USB-C, 3 = Qi. Anything else is plugged in.
    powerSource: asInteger(raw.powerSrc),
    // `userVolume` is the level the user set, already a percent. `volume` is
    // the system level, which night mode can lower on its own.
    volume: clamp(firstNumber(raw.userVolumePercentage, raw.userVolume, raw.volume), 0, 100),
    // 0 = nothing, 1 = physical card, 2 = started remotely, 3 = a stream.
    cardInserted: asInteger(raw.cardInserted),
    activeCard: normalizeCardId(raw.activeCard),
    ambientLight: clamp(asInteger(raw.als), 0, 1000),
    deviceTemperature: clamp(deviceTemperature, -10, 90),
    wifiStrength: clamp(asInteger(raw.wifiStrength), -100, 0),
  };
}

/**
 * Plugged in, which is what the Yoto app calls charging. `charging` alone
 * says "not charging" on a full battery sitting on its dock.
 */
export function isCharging(status) {
  if (status.powerSource !== null && status.powerSource !== undefined) {
    return status.powerSource > 0 || status.isCharging === true;
  }
  return status.isCharging ?? null;
}

/** True when a card or a stream is loaded. */
export function isPlaying(status) {
  return status.cardInserted === null ? null : status.cardInserted > 0;
}

/**
 * `temp` is "{battery}:{device}". Each side is an integer, "0" when unknown,
 * or "notSupported" on a player without the sensor.
 */
export function parseTemperaturePair(value) {
  if (typeof value !== 'string' || !value.includes(':')) {
    return { batteryTemperature: null, deviceTemperature: null };
  }
  const [battery, device] = value.split(':');
  return {
    batteryTemperature: asTemperature(battery),
    deviceTemperature: asTemperature(device),
  };
}

function asTemperature(part) {
  const trimmed = String(part).trim();
  // "0" is the firmware's "I don't know", not a real 0 °C.
  if (trimmed === 'notSupported' || trimmed === '0' || trimmed === '') {
    return null;
  }
  return asInteger(trimmed);
}

function normalizeCardId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'none' ? null : trimmed;
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

function asInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function asBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number !== 0 : null;
}

function clamp(value, min, max) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
