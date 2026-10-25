# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/b3n0/Adavanced-Yoto/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/b3n0/Adavanced-Yoto/releases/tag/v1.0.1
