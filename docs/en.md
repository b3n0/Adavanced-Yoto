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

1. Open the [Yoto applications site](https://dashboard.yoto.dev/) and create
   an application.
2. Under the **Link my Yoto account** button, Gladys shows a redirect
   address. Copy it into the Yoto application and save it there.
3. Copy that application's **Client ID** into **Identifier**. If a secret is
   shown as well, paste it into **Secret**. Otherwise leave that field empty.
   Save the Gladys page.
4. Click **Link my Yoto account**. Yoto's page opens: sign in with the family
   account and approve the application.
5. Click **Test the Yoto connection**. Players appear in the Discovery tab.

The connection stays on by itself. Link the account again only if the Yoto
password changes, or if the application is removed from the account.

**Player update** is how often battery, volume and the night light are read.
300 means 5 minutes, and Gladys cannot go below one minute.
