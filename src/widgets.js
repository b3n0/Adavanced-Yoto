// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys >= 5.1).
//
// Both are drawn from the snapshot of the last poll. Opening a dashboard
// does not call Yoto. Tiles and the chart are bound to device features, so
// they follow the published states; the status rows are the snapshot.
// Texts are English and French: the core falls back to English.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE } from './devices/yotoPlayer.js';
import { BATTERY_LOW_THRESHOLD, WIDGET_ACTION_REFRESH } from './surfaces.js';

const LANGUAGES = ['en', 'fr'];

// The registry nudges the widgets when a poll changes what they show.
// This TTL is only the safety net.
const CONTENT_TTL_SECONDS = 120;

const MAX_LISTED_PLAYERS = 8;

const REFRESH_BUTTON = {
  type: 'button',
  label: { en: 'Refresh', fr: 'Rafraîchir' },
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: WIDGET_ACTION_REFRESH },
};

/**
 * @param {object[]} players known players ({ deviceId, name })
 * @param {Map<string, object>} snapshots deviceId -> last snapshot
 */
export function buildPlayersContent(players, snapshots) {
  if (players.length === 0) {
    return {
      ttl_seconds: CONTENT_TTL_SECONDS,
      components: [
        {
          type: 'text',
          text: {
            en: 'No Yoto player on this account yet.',
            fr: 'Aucun lecteur Yoto sur ce compte pour le moment.',
          },
        },
        REFRESH_BUTTON,
      ],
    };
  }

  const items = players.slice(0, MAX_LISTED_PLAYERS).map((player) => {
    const snapshot = snapshots.get(player.deviceId);
    return {
      title: truncate(player.name, 60),
      subtitle: playingLabel(snapshot, 60),
      badge: batteryBadge(snapshot),
      description: describe(snapshot),
    };
  });

  return {
    ttl_seconds: CONTENT_TTL_SECONDS,
    components: [{ type: 'card-list', display: 'list', items }, REFRESH_BUTTON],
  };
}

/**
 * @param {object} gladys builds the feature external ids
 * @param {object|null} player the player chosen in the settings
 * @param {object|undefined} snapshot its last snapshot
 */
export function buildPlayerContent(gladys, player, snapshot) {
  if (!player) {
    return {
      ttl_seconds: CONTENT_TTL_SECONDS,
      components: [
        {
          type: 'text',
          text: {
            en: 'This Yoto player is no longer on the account: pick another one in the widget settings.',
            fr: 'Ce lecteur Yoto n’est plus sur le compte : choisissez-en un autre dans les réglages du widget.',
          },
        },
      ],
    };
  }

  const ids = gladys.externalIds('yoto-player', player.deviceId);
  return {
    ttl_seconds: CONTENT_TTL_SECONDS,
    components: [
      {
        type: 'value',
        label: { en: 'Battery', fr: 'Batterie' },
        icon: 'battery',
        device_feature: ids.feature(FEATURE.BATTERY),
      },
      {
        type: 'value',
        label: { en: 'Volume', fr: 'Volume' },
        icon: 'volume-2',
        device_feature: ids.feature(FEATURE.VOLUME),
      },
      {
        type: 'value',
        label: { en: 'Temperature', fr: 'Température' },
        icon: 'thermometer',
        device_feature: ids.feature(FEATURE.TEMPERATURE),
      },
      {
        type: 'value',
        label: { en: 'Night light', fr: 'Veilleuse' },
        icon: 'moon',
        device_feature: ids.feature(FEATURE.NIGHTLIGHT),
      },
      {
        type: 'chart',
        title: { en: 'Battery (24 h)', fr: 'Batterie (24 h)' },
        chart_type: 'line',
        device_features: [ids.feature(FEATURE.BATTERY)],
        interval: 'last-day',
      },
      { type: 'status', items: statusItems(snapshot) },
      REFRESH_BUTTON,
    ],
  };
}

function statusItems(snapshot) {
  if (!snapshot) {
    return [
      {
        label: { en: 'State', fr: 'État' },
        value: { en: 'Waiting for the first reading', fr: 'En attente de la première lecture' },
        icon: 'clock',
        color: WIDGET_COLORS.NEUTRAL,
      },
    ];
  }
  return [
    {
      label: { en: 'Playing', fr: 'Lecture' },
      value: playingLabel(snapshot, 40),
      icon: snapshot.playing ? 'play' : 'pause',
      color: snapshot.playing ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Power', fr: 'Alimentation' },
      value:
        snapshot.charging === null
          ? { en: 'Unknown', fr: 'Inconnue' }
          : snapshot.charging
            ? { en: 'Plugged in', fr: 'Sur secteur' }
            : { en: 'On battery', fr: 'Sur batterie' },
      icon: snapshot.charging ? 'battery-charging' : 'battery',
      color: snapshot.charging ? WIDGET_COLORS.SUCCESS : batteryColor(snapshot.batteryLevel),
    },
    {
      label: { en: 'Connection', fr: 'Connexion' },
      value:
        snapshot.online === false
          ? { en: 'Offline', fr: 'Hors ligne' }
          : snapshot.online === true
            ? onlineLabel(snapshot)
            : { en: 'Unknown', fr: 'Inconnue' },
      icon: snapshot.online === false ? 'wifi-off' : 'wifi',
      color: snapshot.online === false ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: { en: 'Night light', fr: 'Veilleuse' },
      value:
        snapshot.nightLight === null
          ? { en: 'Unknown', fr: 'Inconnue' }
          : snapshot.nightLight
            ? { en: 'On', fr: 'Allumée' }
            : { en: 'Off', fr: 'Éteinte' },
      icon: 'moon',
      color: snapshot.nightLight ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
  ];
}

function onlineLabel(snapshot) {
  if (snapshot.wifiStrength === null) {
    return { en: 'Online', fr: 'En ligne' };
  }
  return {
    en: `Online · ${snapshot.wifiStrength} dBm`,
    fr: `En ligne · ${snapshot.wifiStrength} dBm`,
  };
}

function playingLabel(snapshot, maxLength) {
  if (!snapshot) {
    return { en: 'Not read yet', fr: 'Pas encore lu' };
  }
  if (snapshot.online === false) {
    return { en: 'Offline', fr: 'Hors ligne' };
  }
  if (snapshot.playing) {
    return truncate(snapshot.cardTitle ?? snapshot.cardId ?? '?', maxLength);
  }
  return { en: 'Nothing playing', fr: 'Rien en lecture' };
}

function batteryBadge(snapshot) {
  if (!snapshot || snapshot.batteryLevel === null) {
    return undefined;
  }
  return {
    text: `${snapshot.batteryLevel} %`,
    color: snapshot.charging ? WIDGET_COLORS.SUCCESS : batteryColor(snapshot.batteryLevel),
  };
}

function batteryColor(level) {
  if (level === null || level === undefined) {
    return WIDGET_COLORS.NEUTRAL;
  }
  if (level < BATTERY_LOW_THRESHOLD) {
    return WIDGET_COLORS.DANGER;
  }
  if (level < 50) {
    return WIDGET_COLORS.WARNING;
  }
  return WIDGET_COLORS.SUCCESS;
}

function describe(snapshot) {
  if (!snapshot) {
    return undefined;
  }
  const lines = Object.fromEntries(LANGUAGES.map((language) => [language, []]));
  const add = (text) => {
    for (const language of LANGUAGES) {
      lines[language].push(text[language]);
    }
  };
  if (snapshot.volume !== null) {
    add({ en: `Volume: ${snapshot.volume} %`, fr: `Volume : ${snapshot.volume} %` });
  }
  if (snapshot.charging !== null) {
    add(
      snapshot.charging
        ? { en: 'Plugged in', fr: 'Sur secteur' }
        : { en: 'On battery', fr: 'Sur batterie' },
    );
  }
  if (snapshot.deviceTemperature !== null) {
    add({
      en: `Temperature: ${snapshot.deviceTemperature} °C`,
      fr: `Température : ${snapshot.deviceTemperature} °C`,
    });
  }
  if (snapshot.ambientLight !== null) {
    add({
      en: `Ambient light: ${snapshot.ambientLight} lx`,
      fr: `Lumière ambiante : ${snapshot.ambientLight} lx`,
    });
  }
  if (snapshot.wifiStrength !== null) {
    add({ en: `Wi-Fi: ${snapshot.wifiStrength} dBm`, fr: `Wi-Fi : ${snapshot.wifiStrength} dBm` });
  }
  if (snapshot.nightLight !== null) {
    add(
      snapshot.nightLight
        ? { en: 'Night light on', fr: 'Veilleuse allumée' }
        : { en: 'Night light off', fr: 'Veilleuse éteinte' },
    );
  }
  if (lines.en.length === 0) {
    return undefined;
  }
  return Object.fromEntries(LANGUAGES.map((language) => [language, lines[language].join('\n')]));
}

function truncate(text, maxLength) {
  const value = String(text);
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
