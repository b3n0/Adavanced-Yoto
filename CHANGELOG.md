# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Each player reports charging, playback, the card title, ambient light, device temperature, Wi-Fi signal and whether it is online. The card's title, author and cover are the player's now playing.
- Dashboard widgets for every player and for one player.
- Scene triggers when a card starts, when playback stops, and when the battery drops under 20%.
- Scene actions to read one player now and to refresh every player. The configuration screen can refresh every player too.
- A reading can ask the player for a fresh status before using the last report.

### Changed

- Volume and the day and night limits are percentages from 0 to 100. The limits are still stored on the player as its 0–16 knob step.
- Gladys 5.3.0 or later is required.

## [1.0.5] - 2026-10-25

### Fixed

- The night-light colour feature declares its minimum and maximum, so Gladys can register the player.

## [1.0.4] - 2026-10-25

### Changed

- The configuration screen names the Yoto application fields to fill in: the callback address and the permissions to tick.

## [1.0.3] - 2026-10-25

## [1.0.2] - 2026-10-25

### Changed

- The configuration screen explains how to link the Yoto account in plain language.

### Fixed

- Linking the Yoto account opens Yoto's sign-in page. Saving the identifier before the account is linked no longer fails.

## [1.0.1] - 2026-10-25

### Added

- Yoto Player devices in Gladys: night light (switch, colour, brightness),
  playback volume, day and night volume limits, and battery level.
- Scene action to play a Yoto card from its id.
- Yoto account linking with the OAuth2 device-code flow. The access token is
  renewed with the single-use refresh token, using the same scopes as the
  Home Assistant integration. Tokens are never written to the logs.

### Removed

- Demo devices shipped by the Gladys integration template (weather station,
  switch, light, plug, motion sensor, camera, widget).

[Unreleased]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/b3n0/Adavanced-Yoto/releases/tag/v1.0.1
