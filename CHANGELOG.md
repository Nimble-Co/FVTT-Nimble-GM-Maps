# Changelog

All notable changes to this module are documented here.

## [0.1.0] - 2026-09-10

Foundry VTT v14 support. This release requires Foundry v14.364 or newer and
Nimble v0.9.0 or newer; it will not run on v13.

### Changed
- Scene data is now written in the native v14 schema. The scene background,
  foreground, and fog overlay moved onto the new Level document, the flat fog
  fields collapsed into `fog.mode` / `fog.colors`, tokens gained `depth` and a
  level reference, and tile occlusion became a set of modes. Scenes are stamped
  with `_stats.coreVersion` so Foundry no longer re-runs its legacy migrations —
  and no longer rewrites the module's pack — on every world load.
- Requires Nimble v0.9.0+, the first release with Foundry v14 support.

### Fixed
- Roof and tent overlay tiles kept the elevation they were authored with. A
  leftover `overhead` flag made Foundry's v12 tile migration reset every overlay
  to elevation 4 on load, which put the Valley's Rest upstairs roof on the wrong
  layer.
- The "Mine Interior (always dark)" region in Crystal Crag Quarry is now actually
  shipped. The pack builder wrote regions inline instead of into their own
  LevelDB sublevel, so Foundry silently dropped the region and its darkness
  behavior when reading the pack.
- The "Farhope" label on Farhope - City no longer has a null author, which v14
  rejects outright.
- Removed fields v14 has no place for: prototype-only `appendNumber` /
  `prependAdjective` on placed tokens, and texture offset/rotation on tokens,
  tiles, and drawings (all were zero).
- Removed a stray Foundry VTT logo tile from Farhope - City, left behind from
  authoring that scene on top of Foundry's default scene. It was visible and
  hanging off the bottom-right of the map.
- Every document id is now a valid 16-character Foundry id. 129 hand-authored
  ids (23 scenes, 79 walls, 23 lights, 4 tiles) were 14–15 characters, which
  made Foundry log a warning for each one on every world load. Ids were padded
  rather than regenerated so they stay greppable.

  **Breaking:** the 23 scene ids changed, so a world that imported the previous
  release keeps a stale `_stats.compendiumSource` on its copies of those scenes.
  Nothing links to these ids, and re-importing picks up the new ones.

### Added
- `npm run validate` checks every scene, and the built pack, against the data
  model of the Foundry build installed on the machine, then checks scene
  geometry.
- `npm run check:geometry` verifies each scene's canvas matches the pixel
  dimensions of its background art — a mismatch silently rescales the map and
  offsets every traced wall — and flags missing art, tiles or regions that run
  off the canvas, and placeables outside the canvas.

## [0.0.9] - 2026-07-18

Initial public release.

### Added
- Pre-configured battle map scenes for the Nimble GM Guide adventures, with
  hand-traced walls, doors, windows, terrain, lighting, and monster tokens.
- 28 scenes in the "Nimble GM Guide Scenes" compendium, organized into
  per-adventure folders (A Tiny Rescue, Beyond the Crimson Veil, Crystal Crag
  Quarry, Greenthumb's Base, Hidden Honey Cavern, Lost Temple, Raid on the
  Royal Nest, The Hag's Legacy, Vanishing Caravans, Vermin's Vengeance, and
  world maps).
- Automatic import of referenced monster actors when a scene is imported.
- Nimble-appropriate lighting: torches and lanterns illuminate 6 spaces, with
  no bright/dim split.
