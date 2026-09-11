import { ClassicLevel } from 'classic-level';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const moduleJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'module.json'), 'utf8'));

/**
 * The Scene document hierarchy, mirroring Foundry's own sublevel layout: every
 * embedded collection lives in a `<parent sublevel>.<collection>` sublevel keyed
 * `<parent id>.<document id>`, and the parent keeps only the ids. Nesting matters
 * — Region behaviors land in `scenes.regions.behaviors`. A collection missing
 * from this map is written inline, which Foundry cannot read back.
 */
const SCENE_HIERARCHY = {
	drawings: {},
	levels: {},
	lights: {},
	notes: {},
	regions: { behaviors: {} },
	sounds: {},
	tiles: {},
	tokens: {},
	walls: {},
};

/**
 * LevelDB wrapper for building FoundryVTT compendium packs
 */
class LevelDatabase extends ClassicLevel {
	#dbKey;
	#hierarchy;
	#sublevels = new Map();

	constructor(location, options) {
		const dbOptions = options.dbOptions ?? { keyEncoding: 'utf8', valueEncoding: 'json' };
		super(location, dbOptions);

		this.dbOptions = dbOptions;
		this.#dbKey = options.dbKey ?? 'scenes';
		this.#hierarchy = options.hierarchy ?? {};
	}

	/**
	 * Sublevels are created on demand and reused, so a collection is only opened
	 * when something is actually written to it.
	 */
	#sublevel(name) {
		if (!this.#sublevels.has(name)) {
			this.#sublevels.set(name, this.sublevel(name, this.dbOptions));
		}
		return this.#sublevels.get(name);
	}

	async createPack(docs, options = {}) {
		const folders = Array.isArray(options.folders) ? options.folders : [];
		const batches = new Map();

		/**
		 * Queue a put into the sublevel's batch, opening it the first time it is used.
		 */
		const put = (sublevelName, key, value) => {
			if (!batches.has(sublevelName)) {
				batches.set(sublevelName, this.#sublevel(sublevelName).batch());
			}
			batches.get(sublevelName).put(key, value);
		};

		/**
		 * Write one document, recursing into its embedded collections and replacing
		 * each with the array of ids Foundry expects to find in the parent record.
		 */
		const writeDocument = (doc, sublevelName, key, hierarchy) => {
			for (const [collection, childHierarchy] of Object.entries(hierarchy)) {
				const embedded = doc[collection];
				if (!Array.isArray(embedded)) continue;
				const childSublevel = `${sublevelName}.${collection}`;
				doc[collection] = embedded.map((child) => {
					if (!child?._id) {
						console.warn(`  ! ${collection} entry in ${key} has no _id and was skipped`);
						return null;
					}
					writeDocument(child, childSublevel, `${key}.${child._id}`, childHierarchy);
					return child._id;
				}).filter((id) => id !== null);
			}
			put(sublevelName, key, doc);
		};

		for (const source of docs) {
			writeDocument(source, this.#dbKey, source._id ?? '', this.#hierarchy);
		}

		for (const folder of folders) {
			put('folders', folder._id ?? '', folder);
		}

		for (const [name, batch] of batches) {
			if (batch.length) {
				console.log(`  ${name}: ${batch.length} records`);
				await batch.write();
			}
		}

		await this.close();
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
		hierarchy: SCENE_HIERARCHY,
	});

	// Folders carry the same _stats stamp as the scenes so Foundry treats the
	// whole pack as current and leaves it alone at world load.
	const folderStats = () => ({
		coreVersion: moduleJson.compatibility.minimum,
		systemId: moduleJson.relationships.systems[0].id,
		systemVersion: moduleJson.relationships.systems[0].compatibility.minimum,
		createdTime: null,
		modifiedTime: null,
		lastModifiedBy: null,
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
				flags: {},
				_stats: folderStats(),
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
