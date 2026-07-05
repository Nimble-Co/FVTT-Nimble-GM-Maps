/**
 * Script to organize map assets from source folder to module assets folder
 * Renames files to URL-friendly names and organizes by adventure
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceDir = path.join(rootDir, 'Nimble GM Guide Battlemaps');
const destDir = path.join(rootDir, 'assets', 'maps');

/**
 * Convert a source image to a WebP at destPath, stripping EXIF/XMP/ICC metadata
 * (cwebp drops metadata by default). Requires the `cwebp` binary on PATH.
 * PNGs (overlays) use a higher quality + max alpha quality to keep edges crisp.
 * @param {string} src - absolute source image path
 * @param {string} destPath - absolute .webp destination path
 */
function convertToWebp(src, destPath) {
	const isPng = path.extname(src).toLowerCase() === '.png';
	const args = isPng
		? ['-q', '90', '-alpha_q', '100', '-m', '4', '-mt', src, '-o', destPath]
		: ['-q', '82', '-m', '4', '-mt', src, '-o', destPath];
	execFileSync('cwebp', args, { stdio: 'ignore' });
}

// Map of source patterns to destination info
const mapConfig = [
	// 01 - A Tiny Rescue
	{
		adventure: 'a-tiny-rescue',
		maps: [
			{
				sourcePath: '01 - A Tiny Rescue/A Tiny Rescue - Goblin Encampment/A Tiny Rescue - Goblin Encampment - noGrid Lights - 15x15 - 200ppi.jpg',
				destName: 'goblin-encampment.jpg'
			},
			{
				sourcePath: '01 - A Tiny Rescue/A Tiny Rescue - Valley\'s Rest/Ground/A Tiny Rescue - Valley\'s Rest Ground - noGrid noLights - 22x29 - 200ppi.jpg',
				destName: 'valleys-rest-ground.jpg'
			},
			{
				sourcePath: '01 - A Tiny Rescue/A Tiny Rescue - Valley\'s Rest/Upstairs/A Tiny Rescue - Valley\'s Rest Upstairs - noGrid noLights - 22x29 - 200ppi.jpg',
				destName: 'valleys-rest-upstairs.jpg'
			},
			{
				sourcePath: '01 - A Tiny Rescue/A Tiny Rescue - Valley\'s Rest/Upstairs Overlay/A Tiny Rescue - Valley\'s Rest UpstairsOverlay - noGrid noLights - 22x29 - 200ppi.png',
				destName: 'valleys-rest-upstairs-overlay.png'
			},
			{
				sourcePath: '01 - A Tiny Rescue/A Tiny Rescue - Valley\'s Rest/Roof Overlay/A Tiny Rescue - Valley\'s Rest Roof Overlay - noGrid noLights - 22x29 - 200ppi.png',
				destName: 'valleys-rest-roof-overlay.png'
			}
		]
	},
	// 02 - Goblins of the Crystal Crag
	{
		adventure: 'goblins-of-the-crystal-crag',
		maps: [
			{
				sourcePath: '02 - Goblins of the Crystal Crag/Goblins of the Crystal Crag - Dungeon/Goblins of the Crystal Crag - Dungeon - noGrid noLights - 40x24 - 200ppi.jpg',
				destName: 'dungeon.jpg'
			}
		]
	},
	// 03 - Greenthumb's Base
	{
		adventure: 'greenthumbs-base',
		maps: [
			{
				sourcePath: '03 - Greenthumb\'s Base/Greenthumb\'s Base - Dungeon/Greenthumb\'s Base - Dungeon - noGrid noLights - 34x23 - 200ppi.jpg',
				destName: 'dungeon.jpg'
			},
			{
				sourcePath: '03 - Greenthumb\'s Base/Greenthumb\'s Base - Entrance/Greenthumb\'s Base - Entrance - noGrid noLights - 20x13 - 200ppi.jpg',
				destName: 'entrance.jpg'
			}
		]
	},
	// 03 - The Hidden Honey Cavern
	{
		adventure: 'hidden-honey-cavern',
		maps: [
			{
				sourcePath: '03 - The Hidden Honey Cavern/The Hidden Honey Cavern - Dungeon/The Hidden Honey Cavern - Dungeon - noGrid noLights - 30x25 - 200ppi.jpg',
				destName: 'dungeon.jpg'
			},
			{
				sourcePath: '03 - The Hidden Honey Cavern/The Hidden Honey Cavern - Treant Sentinals/The Hidden Honey Cavern - Treant Sentinals - noGrid noLights - 12x12 - 200ppi.jpg',
				destName: 'treant-sentinels.jpg'
			}
		]
	},
	// 03 - Vermin's Vengeance
	{
		adventure: 'vermins-vengeance',
		maps: [
			{
				sourcePath: '03 - Vermin\'s Vengeance/Vermin\'s Vengeance - Dungeon/Vermin\'s Vengeance - Dungeon - noGrid noLights - 26x21 - 200ppi.jpg',
				destName: 'dungeon.jpg'
			},
			{
				sourcePath: '03 - Vermin\'s Vengeance/Vermin\'s Vengeance - Living Fatberg/Vermin\'s Vengeance - Living Fatberg - noGrid noLights - 12x12 - 200ppi.jpg',
				destName: 'living-fatberg.jpg'
			}
		]
	},
	// 04 - The Vanishing Caravans
	{
		adventure: 'vanishing-caravans',
		maps: [
			{
				sourcePath: '04 - The Vanishing Caravans/The Vanishing Caravans - Camp/Ground/The Vanishing Caravans - Camp Ground - noGrid noLights - 40x25 - 200ppi.jpg',
				destName: 'camp-ground.jpg'
			},
			{
				sourcePath: '04 - The Vanishing Caravans/The Vanishing Caravans - Camp/Tents/The Vanishing Caravans - Tents - noGrid noLights - 40x25 - 200ppi.jpg',
				destName: 'camp-tents.jpg'
			},
			{
				sourcePath: '04 - The Vanishing Caravans/The Vanishing Caravans - Camp/TentsOverlay/The Vanishing Caravans - Camp TentsOverlay - noGrid noLights - 40x25 - 200ppi.png',
				destName: 'camp-tents-overlay.png'
			}
		]
	},
	// 04 - Raid on the Royal Nest
	{
		adventure: 'raid-on-the-royal-nest',
		maps: [
			{
				sourcePath: '04 - Raid on the Royal Nest/Raid on the Royal Nest - Dungeon/Raid on the Royal Nest - Dungeon - noGrid noLights - 44x30 - 200ppi.jpg',
				destName: 'dungeon.jpg'
			},
			{
				sourcePath: '04 - Raid on the Royal Nest/Raid on the Royal Nest - Storm Drakes/Raid on the Royal Nest - Storm Drakes - noGrid noLights - 12x12 - 200ppi.jpg',
				destName: 'storm-drakes.jpg'
			}
		]
	},
	// 04 - The Hag's Legacy
	{
		adventure: 'the-hags-legacy',
		maps: [
			{
				sourcePath: '04 - The Hag\'s Legacy/The Hag\'s Legacy - Donkey Chase/The Hag\'s Legacy - Donkey Chase - noGrid noLights - 15x15 - 200ppi.jpg',
				destName: 'donkey-chase.jpg'
			},
			{
				sourcePath: '04 - The Hag\'s Legacy/The Hag\'s Legacy - Spiderhollow/Ground Floor/The Hag\'s Legacy - Spiderhollow Ground - noGrid noLights - 26x14 - 200ppi.jpg',
				destName: 'spiderhollow-ground.jpg'
			},
			{
				sourcePath: '04 - The Hag\'s Legacy/The Hag\'s Legacy - Spiderhollow/Roost/The Hag\'s Legacy - Spiderhollow Roost - noGrid noLights - 26x14 - 200ppi.jpg',
				destName: 'spiderhollow-roost.jpg'
			},
			{
				sourcePath: '04 - The Hag\'s Legacy/The Hag\'s Legacy - Spiderhollow/Roost Overlay/The Hag\'s Legacy - Spiderhollow RoostOverlay - noGrid noLights - 26x14 - 200ppi.png',
				destName: 'spiderhollow-roost-overlay.png'
			}
		]
	},
	// 05 - Lost Temple of Heytet-Seqat
	{
		adventure: 'lost-temple-of-heytet-seqat',
		maps: [
			{
				sourcePath: '05 - Lost Temple of Heytet-Seqat/Lost Temple of Heytet-Seqat - Dungeon/Lost Temple of Heytet-Seqat - Dungeon - noGrid noLights - 31x22 - 200ppi.jpg',
				destName: 'dungeon.jpg'
			},
			{
				sourcePath: '05 - Lost Temple of Heytet-Seqat/Lost Temple of Heytet-Seqat - Ruined Caravan/Lost Temple of Heytet-Seqat - Ruined Caravan - noLights noGrid - 12x12 - 200ppi.jpg',
				destName: 'ruined-caravan.jpg'
			}
		]
	},
	// 14 - Beyond the Crimson Veil
	{
		adventure: 'beyond-the-crimson-veil',
		maps: [
			{
				sourcePath: '14 - Beyond the Crimson Veil/Beyond the Crimson Veil - Bodies/Beyond the Crimson Veil - Bodies - noGrid noLights - 12x12 - 200ppi.jpg',
				destName: 'bodies.jpg'
			},
			{
				sourcePath: '14 - Beyond the Crimson Veil/Beyond the Crimson Veil - Blood Vats/Beyond the Crimson Veil - Blood Vats - noGrid noLights - 15x15 - 200ppi.jpg',
				destName: 'blood-vats.jpg'
			},
			{
				sourcePath: '14 - Beyond the Crimson Veil/Beyond the Crimson Veil - Duel Before the Veil/Beyond the Crimson Veil - Duel Before The Veil - noGrid noLights - 12x12 - 200ppi.jpg',
				destName: 'duel-before-the-veil.jpg'
			},
			{
				sourcePath: '14 - Beyond the Crimson Veil/Beyond the Crimson Veil - North Blood Engine/North Blood Engine - noGrid noLights - 15x15 - 200ppi.jpg',
				destName: 'north-blood-engine.jpg'
			},
			{
				sourcePath: '14 - Beyond the Crimson Veil/Beyond the Crimson Veil - South Blood Engine/Beyond the Crimson Veil - South Blood Engine - noGrid noLights - 15x15 - 200ppi.jpg',
				destName: 'south-blood-engine.jpg'
			},
			{
				sourcePath: '14 - Beyond the Crimson Veil/Beyond the Crimson Veil - Visions of Dread/Beyond the Crimson Veil - Visions of Dread - noGrid noLights - 15x15 - 200ppi.jpg',
				destName: 'visions-of-dread.jpg'
			}
		]
	}
];

// Process each adventure
let totalCopied = 0;
let totalFailed = 0;

for (const adventure of mapConfig) {
	const adventureDir = path.join(destDir, adventure.adventure);

	// Create adventure directory
	if (!fs.existsSync(adventureDir)) {
		fs.mkdirSync(adventureDir, { recursive: true });
	}

	console.log(`\nProcessing: ${adventure.adventure}`);

	for (const map of adventure.maps) {
		const sourcePath = path.join(sourceDir, map.sourcePath);
		// Shipped assets are WebP (smaller, metadata-stripped). Scene JSON
		// references use the .webp extension to match.
		const baseName = path.basename(map.destName, path.extname(map.destName));
		const destPath = path.join(adventureDir, `${baseName}.webp`);

		if (!fs.existsSync(sourcePath)) {
			console.log(`  [MISSING] ${map.sourcePath}`);
			totalFailed++;
			continue;
		}

		try {
			convertToWebp(sourcePath, destPath);
			console.log(`  [OK] ${baseName}.webp`);
			totalCopied++;
		} catch (err) {
			console.log(`  [ERROR] ${baseName}.webp: ${err.message}`);
			totalFailed++;
		}

		// Also emit the "Grid Lights" reference variant alongside the shipped
		// map, so grids/lights can be authored against it in Foundry. These are
		// temporary and get removed once all walls/lights are placed. Overlays
		// have no meaningful grid/lights variant, so skip them.
		if (!map.destName.includes('overlay')) {
			const srcMapDir = path.dirname(sourcePath);
			const glSource = fs
				.readdirSync(srcMapDir)
				.find((f) => / - (Grid Lights?|Lights? Grid) - /.test(f));

			if (glSource) {
				const refName = `${baseName}-grid-lights.webp`;
				try {
					convertToWebp(path.join(srcMapDir, glSource), path.join(adventureDir, refName));
					console.log(`  [OK] ${refName} (reference)`);
					totalCopied++;
				} catch (err) {
					console.log(`  [ERROR] ${refName}: ${err.message}`);
					totalFailed++;
				}
			} else {
				console.log(`  [NO GRID-LIGHTS REF] ${map.destName}`);
			}
		}
	}
}

console.log(`\n=== Summary ===`);
console.log(`Copied: ${totalCopied}`);
console.log(`Failed: ${totalFailed}`);
