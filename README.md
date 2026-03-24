# Nimble Maps

Pre-configured battle map scenes for the Nimble GM Guide adventures with walls, lighting, and monster tokens.

## Requirements

- Foundry VTT v13
- [Nimble System](https://github.com/Quest-Luminary/Nimble-FVTT) v0.6.0+

## Installation

### From Manifest URL

Install using the following manifest URL in Foundry's "Add-on Modules" installer:

```
https://github.com/trevlar/FVTT-Nimble-GM-Maps/releases/latest/download/module.json
```

### Manual Installation

Download the latest release and extract it to your Foundry VTT modules folder:

```
~/Library/Application Support/FoundryVTT/Data/modules/nimble-maps
```

## Usage

1. Enable "Nimble Maps" in your world's module settings
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

## License

MIT
