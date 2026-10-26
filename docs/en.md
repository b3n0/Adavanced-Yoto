# Yoto Player Advanced

This integration adds every Yoto Player of a Yoto account to Gladys Assistant:
night light, volume, sensors, and card playback from a scene. Gladys 5.3 or
later is required.

## What you get

After the account is linked, each player shows up in the **Discovery** tab.
Updating a player that is already added (the **Update** button on that tab)
adds the new features.

Controls:

- **Night light** — on/off and colour of the light ring for the profile the
  player is in (day or night). Off sends Yoto's `#0` colour.
- **Brightness** — screen brightness of that same profile, from 0 to 100.
  The value `auto` is shown as 100; moving the slider stores a fixed number.
- **Volume** — from 0 to 100%.
- **Day max volume** and **Night max volume** — the limits, shown from 0 to
  100%. The player stores them on its 17-step knob: the slider snaps to the
  nearest step.

Read-only:

- **Battery**, **Charging** (plugged in, including a full battery),
  **Online**, **Wi-Fi signal**, **Ambient light**, **Temperature**.
- **Playing** and **Card playing**. The title, the author and the cover feed
  Gladys' music player. The track and the position are not available: the
  API does not provide them.

## Dashboard

Two widgets: **Yoto players** (every player of the account) and **Yoto
player** (one player, with the 24 h battery curve). They show the last
reading. **Refresh** reads the player immediately.

## Scenes

Triggers:

- **A card starts** — filters: player, exact title. Variables: player name,
  title, id.
- **A player stops playing** — filter: player.
- **Battery low** — under 20%, once, until the player is plugged in or the
  level climbs back above 25%.

Actions:

- **Play a Yoto card** — player, card id (for example `5WsQg`), track index
  (0 is the first track of chapter 01).
- **Read a Yoto player** — reads now and passes battery, volume, card,
  temperature and night light to the next steps.
- **Refresh all Yoto players**.

The first reading after a start does not fire a scene.

## Configuration

Open the [Yoto applications site](https://dashboard.yoto.dev/), create an
application, then open **Edit Application**.

1. **Application Type**: leave **Public Client**.
2. **Allowed Callback URLs**: erase the example and put only
   `https://my.gladysassistant.com/redirect/oauth`.
3. **Scopes**: tick `family:devices:control`, `family:devices:manage`,
   `family:view` and `offline_access`. Rights already marked Included
   automatically are enough, including `family:library:view` for card
   titles. Do not tick `family:library:manage` or `user:content:manage`.
4. Leave **Description**, **Allowed Logout URLs**, **Application Logo** and
   **Application Privacy Policy URL** empty.
5. Click **Update Application**.
6. In Gladys, copy the **Client ID** into **Identifier**. Leave **Secret**
   empty, save, then click **Link my Yoto account**. Sign in with the family
   account.
7. Click **Test the Yoto connection**. Players appear in the Discovery tab.

The connection stays on by itself. Link the account again only if the Yoto
password changes, or if the application is removed from the account.

**Player update** is how long to wait between readings. 300 means 5 minutes,
and Gladys cannot go below one minute. **Ask the player for a fresh status**
asks the player to report before the reading. Turn it off if the player
wakes too often.
