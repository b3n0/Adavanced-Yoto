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

The Yoto access token lasts a few hours. The integration also keeps a
single-use refresh token and exchanges it for a new pair before the access
token expires, so the link stays up while Yoto accepts it.

1. In the Yoto developer dashboard, create an application that allows the
   **device code** grant and copy the client id. The scopes are the ones used
   by the Home Assistant integration: `offline_access` and the `family`
   device scopes. See the
   [Yoto guide](https://yoto.dev/authentication/headless-cli-auth/).
2. Paste the client id. Paste the secret too when the application is
   confidential. A public device-code client has no secret.
3. Save, then click **Link my Yoto account**. Yoto's page opens: sign in and
   approve the application.
4. Use **Test the Yoto connection**. Players appear in the Discovery tab.

Link the account again only if you change the Yoto password, revoke the
application in the Yoto account, or Yoto keeps rejecting the session. Tokens
are never written to the logs.

The **refresh interval** is how often battery, volume and the night light are
read. The default is 5 minutes, and Gladys cannot poll faster than one minute.
