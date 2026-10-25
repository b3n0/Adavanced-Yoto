# Yoto Player Advanced

This integration adds every Yoto Player of a Yoto account to Gladys Assistant:
night light, volume limits, battery, and card playback from a scene.

## What you get

After the account is linked, each player shows up in the **Discovery** tab:

- **Night light** — on/off and colour of the light ring for the profile the
  player is in (day or night). Off sends Yoto's `#0` colour.
- **Brightness** — screen brightness of that same profile, from 0 to 100.
  The value `auto` is shown as 100; moving the slider stores a fixed number.
- **Volume** — the player knob, from 0 to 16.
- **Day max volume** and **Night max volume** — the limits stored on the player.
- **Battery** — read-only percentage.

## Play a card from a scene

In the scene editor, add the action **Play a Yoto card**:

1. Choose the player.
2. Enter the card id (for example `5WsQg`).
3. Leave the track index at 0 to start the first track of chapter 01.

## Configuration

Open the [Yoto applications site](https://dashboard.yoto.dev/), create an
application, then open **Edit Application**.

1. **Application Type**: leave **Public Client**.
2. **Allowed Callback URLs**: erase the example and put only
   `https://my.gladysassistant.com/redirect/oauth`.
3. **Scopes**: tick `family:devices:control`, `family:devices:manage`,
   `family:view` and `offline_access`. Rights already marked Included
   automatically are enough. Do not tick `family:library:manage` or
   `user:content:manage`.
4. Leave **Description**, **Allowed Logout URLs**, **Application Logo** and
   **Application Privacy Policy URL** empty.
5. Click **Update Application**.
6. In Gladys, copy the **Client ID** into **Identifier**. Leave **Secret**
   empty, save, then click **Link my Yoto account**. Sign in with the family
   account.
7. Click **Test the Yoto connection**. Players appear in the Discovery tab.

The connection stays on by itself. Link the account again only if the Yoto
password changes, or if the application is removed from the account.

**Player update** is how often battery, volume and the night light are read.
300 means 5 minutes, and Gladys cannot go below one minute.
