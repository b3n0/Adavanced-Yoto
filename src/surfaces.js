// -----------------------------------------------------------------------------
// Keys Gladys stores forever: widget keys, scene-trigger keys, and the
// battery level under which a scene can fire. Renaming one orphans the
// dashboards and scenes the user already created.
// -----------------------------------------------------------------------------

export const WIDGET = {
  PLAYERS: 'players',
  PLAYER: 'player',
};

/** Key of the Refresh button, the same on both widgets. */
export const WIDGET_ACTION_REFRESH = 'refresh';

export const SCENE_TRIGGER = {
  CARD_STARTED: 'card_started',
  CARD_STOPPED: 'card_stopped',
  BATTERY_LOW: 'battery_low',
};

/** Under this level (%), a player that is not plugged in fires battery_low. */
export const BATTERY_LOW_THRESHOLD = 20;
