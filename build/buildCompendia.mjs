import { ClassicLevel } from 'classic-level';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * LevelDB wrapper for building FoundryVTT compendium packs
 */
class LevelDatabase extends ClassicLevel {
	#dbKey;
	#embeddedKeys;
	#documentDb;
	#embeddedDbs;

	constructor(location, options) {
		const dbOptions = options.dbOptions ?? { keyEncoding: 'utf8', valueEncoding: 'json' };
		super(location, dbOptions);

		this.dbOptions = dbOptions;
		this.#dbKey = options.dbKey ?? 'scenes';
		this.#embeddedKeys = options.embeddedKeys ?? [];

		this.#documentDb = this.sublevel(this.#dbKey, dbOptions);

		if (this.#embeddedKeys.length) {
			this.#embeddedDbs = this.#embeddedKeys.map((key) => ({
				key: key.replaceAll('.', '-'),
				db: this.sublevel(`${this.#dbKey}.${key}`, dbOptions),
			}));
		} else {
			this.#embeddedDbs = [];
		}
	}

	async createPack(docs, options = {}) {
		const folders = Array.isArray(options.folders) ? options.folders : [];

		const docBatch = this.#documentDb.batch();
		const embeddedBatches = this.#embeddedDbs.reduce((acc, { key, db }) => {
			acc[key] = db.batch();
			return acc;
		}, {});
		const folderDb = folders.length > 0 ? this.sublevel('folders', this.dbOptions) : null;
		const folderBatch = folderDb ? folderDb.batch() : null;

		for (const source of docs) {
			// Handle embedded documents (walls, lights, tokens, tiles, etc.)
			if (this.#embeddedKeys.length) {
				this.#embeddedKeys.forEach((key) => {
					const embeddedDocs = source[key];
					this.#addDataToBatch(embeddedDocs, embeddedBatches[key], source._id);
				});
			}
			docBatch.put(source._id ?? '', source);
		}

		if (folderBatch) {
			for (const folder of folders) {
				folderBatch.put(folder._id ?? '', folder);
			}
		}

		await docBatch.write();
		for await (const batch of Object.values(embeddedBatches)) {
			if (batch.length) await batch.write();
		}
		if (folderBatch?.length) await folderBatch.write();

		await this.close();
	}

	#addDataToBatch(embeddedDocs, batch, sourceId) {
		if (Array.isArray(embeddedDocs)) {
			for (let i = 0; i < embeddedDocs.length; i += 1) {
				const doc = embeddedDocs[i];
				if (batch && doc._id) {
					batch.put(`${sourceId}.${doc._id}`, doc);
					embeddedDocs[i] = doc._id ?? '';
				}
			}
		}
	}
}

/**
 * Generate a random 16-character alphanumeric ID (FoundryVTT style)
 */
function generateId() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 16; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/**
 * Load all scene JSON files from src/scenes directory
 */
function loadScenes() {
	const scenesDir = path.join(rootDir, 'src', 'scenes');
	const scenes = [];

	// Recursively find all JSON files
	function walkDir(dir) {
		if (!fs.existsSync(dir)) return;

		const files = fs.readdirSync(dir);
		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);

			if (stat.isDirectory()) {
				walkDir(filePath);
			} else if (file.endsWith('.json')) {
				try {
					const content = fs.readFileSync(filePath, 'utf8');
					const scene = JSON.parse(content);

					// Ensure scene has an _id
					if (!scene._id) {
						scene._id = generateId();
					}

					scenes.push(scene);
					console.log(`  Loaded: ${scene.name}`);
				} catch (err) {
					console.error(`  Error loading ${filePath}: ${err.message}`);
				}
			}
		}
	}

	walkDir(scenesDir);
	return scenes;
}

/**
 * Build the scenes compendium
 */
async function buildScenesPack() {
	const packPath = path.join(rootDir, 'packs', 'scenes');

	// Remove existing pack
	if (fs.existsSync(packPath)) {
		fs.rmSync(packPath, { recursive: true });
	}
	fs.mkdirSync(packPath, { recursive: true });

	console.log('Loading scene files...');
	const scenes = loadScenes();

	if (scenes.length === 0) {
		console.log('No scenes found in src/scenes/');
		return;
	}

	console.log(`\nBuilding compendium with ${scenes.length} scenes...`);

	const db = new LevelDatabase(packPath, {
		dbKey: 'scenes',
		// Scene embedded documents
		embeddedKeys: ['walls', 'lights', 'tokens', 'tiles', 'drawings', 'notes', 'sounds']
	});

	// Create adventure folders for organization
	const folderMap = new Map();
	const folders = [];

	for (const scene of scenes) {
		if (scene.folder && !folderMap.has(scene.folder)) {
			const folderId = generateId();
			folderMap.set(scene.folder, folderId);
			folders.push({
				_id: folderId,
				name: scene.folder,
				type: 'Scene',
				sort: 0,
				color: null,
				flags: {}
			});
			// Update scene to use folder ID
			scene.folder = folderId;
		} else if (scene.folder) {
			scene.folder = folderMap.get(scene.folder);
		}
	}

	await db.createPack(scenes, { folders });
	console.log('Compendium built successfully!');
}

// Run the build
console.log('=== Building Nimble Maps Compendium ===\n');
buildScenesPack().catch(console.error);
