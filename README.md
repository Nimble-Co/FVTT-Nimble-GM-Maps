# Nimble GM Guide Maps

Pre-configured battle map scenes for the Nimble GM Guide adventures with walls, lighting, and monster tokens.

## Requirements

- Foundry VTT v13
- [Nimble System](https://github.com/Quest-Luminary/Nimble-FVTT) v0.6.0+

## Installation

### From Manifest URL

Install using the following manifest URL in Foundry's "Add-on Modules" installer:

```
https://github.com/Nimble-Co/FVTT-Nimble-GM-Maps/releases/latest/download/module.json
```

### Manual Installation

Download the latest release and extract it to your Foundry VTT modules folder:

```
~/Library/Application Support/FoundryVTT/Data/modules/nimble-maps
```

## Usage

1. Enable "Nimble GM Guide Maps" in your world's module settings
2. Open the "Nimble GM Guide Scenes" compendium
3. Import any scene to your world

When you import a scene, any referenced monster actors will be automatically imported from their compendiums.

## Development

### Setup

```bash
pnpm install
```

### Link to Foundry (macOS)

```bash
pnpm run dev:link
```

### Build Compendiums

```bash
pnpm run build
```

## Credits

- **Maps:** Created by Matt "Double King" Shiffler for the adventures in the Nimble GM Guide.
- **Nimble:** © 2025 Nimble Co. — [nimblerpg.com](https://nimblerpg.com)

## License

This module bundles two kinds of content under different terms. See [LICENSE](LICENSE) for the full text.

- **Code** — everything under `scripts/`, `build/`, and the scene data under `src/` is released under the **MIT License**, © 2026 Nimble Co. / Trevor Carlston.
- **Map art and adventure content** — the battle map images under `assets/` are **© Nimble Co.**, distributed as part of the official Nimble GM Guide and included here with permission. They are free to use within Foundry VTT via this module, but may not be redistributed, resold, or used outside of this module without permission from Nimble Co.
