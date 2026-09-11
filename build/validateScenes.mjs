/**
 * Validate the scene data against the real Foundry VTT data model — first the
 * sources in src/scenes, then the built compendium in packs/scenes.
 *
 * Loads `common/server.mjs` out of an installed Foundry application and runs each
 * scene through `BaseScene`, so the schema we check against is the one the target
 * Foundry build actually enforces rather than a copy that drifts.
 *
 * Reports three things:
 *   - schema errors, which are what a v14 compatibility problem looks like
 *   - dropped keys, which load fine but silently discard authored data; a field
 *     renamed between generations shows up here
 *   - malformed ids, which Foundry only warns about — see takeMalformedIds below
 *
 * The pack pass reassembles each scene out of its LevelDB sublevels exactly as
 * Foundry does, which is what catches an embedded collection the build wrote
 * inline instead of into its own sublevel.
 *
 *   node build/validateScenes.mjs
 *   FOUNDRY_APP=/path/to/app node build/validateScenes.mjs
 */

import { ClassicLevel } from "classic-level";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(
	readFileSync(join(rootDir, "module.json"), "utf-8"),
);

const APP_CANDIDATES = [
	process.env.FOUNDRY_APP,
	"/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app",
	join(process.env.HOME ?? "", "foundryvtt"),
	"/opt/foundryvtt",
].filter(Boolean);

const appDir = APP_CANDIDATES.find((dir) =>
	existsSync(join(dir, "common", "server.mjs")),
);
if (!appDir) {
	console.error(
		"Could not find an installed Foundry VTT application. Set FOUNDRY_APP to the\n" +
			"directory containing common/server.mjs (on macOS:\n" +
			'  "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app").',
	);
	process.exit(1);
}

const appRelease = JSON.parse(
	readFileSync(join(appDir, "package.json"), "utf-8"),
).release;
const appVersion = `${appRelease.generation}.${appRelease.build}`;

// Foundry's data models read the active system's grid defaults while building
// their schemas. Use the real system manifest when it can be found so the
// defaults match what a player's world would apply.
const systemId = moduleJson.relationships.systems[0].id;
const systemPaths = [
	join(
		process.env.HOME ?? "",
		"Library/Application Support/FoundryVTT/Data/systems",
		systemId,
		"system.json",
	),
	join(
		process.env.HOME ?? "",
		`.local/share/FoundryVTT/Data/systems/${systemId}/system.json`,
	),
];
const systemJson = systemPaths
	.filter((p) => existsSync(p))
	.map((p) => JSON.parse(readFileSync(p, "utf-8")))[0];

/**
 * Foundry resolves RegionBehavior subtypes through `game.model`, which the
 * client builds from CONFIG. Read the core behavior types straight out of the
 * installed build's config so this list tracks the app rather than drifting;
 * an empty result just means behavior types go unchecked.
 * @returns {Record<string, object>}
 */
function coreRegionBehaviorTypes() {
	const config = readFileSync(join(appDir, "client", "config.mjs"), "utf-8");
	const block = config.match(
		/export const RegionBehavior = \{[\s\S]*?dataModels: \{([\s\S]*?)\n {2}\}/,
	);
	const types = [...(block?.[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
	return Object.fromEntries(types.map((type) => [type, {}]));
}

globalThis.game = {
	system: {
		id: systemId,
		version:
			systemJson?.version ??
			moduleJson.relationships.systems[0].compatibility.minimum,
		grid: systemJson?.grid ?? {
			type: 1,
			size: 100,
			distance: 5,
			units: "ft",
			diagonals: 0,
		},
		documentTypes: {},
	},
	release: { version: appVersion, generation: appRelease.generation },
	modules: new Map(),
	// Document subtypes are enumerated from here.
	model: { RegionBehavior: coreRegionBehaviorTypes() },
};
globalThis.release = globalThis.game.release;
globalThis.logger = console;

// Documents resolve their configured subclass through CONFIG; with no entries
// each falls back to its own base class, which is what we want to validate.
// Token#movementAction draws its allowed values from CONFIG.Token.movement and
// RegionBehavior resolves its `system` data model through CONFIG.RegionBehavior.
// Both are populated only by the client, so those two fields are cleaned as
// plain data here rather than checked against their real definitions.
globalThis.CONFIG = { Token: {}, RegionBehavior: { dataModels: {} } };

await import(`${appDir}/common/server.mjs`);
const { BaseScene } = foundry.documents;

const EMBEDDED = [
	"drawings",
	"levels",
	"lights",
	"notes",
	"regions",
	"sounds",
	"tiles",
	"tokens",
	"walls",
];

const VALID_ID = /^[A-Za-z0-9]{16}$/;
const PLACEHOLDER_ID = "aaaaaaaaaaaaaaaa";

console.log(`Validating against Foundry ${appVersion} (${appDir})`);
console.log(`System grid: ${JSON.stringify(globalThis.game.system.grid)}\n`);

/**
 * Collect dotted paths of every key present in `before` but gone from `after`,
 * which is how the schema reports data it refused to keep.
 * @param {unknown} before
 * @param {unknown} after
 * @param {string} [path]
 * @returns {string[]}
 */
function droppedKeys(before, after, path = "") {
	if (Array.isArray(before)) {
		if (!Array.isArray(after)) return [path];
		return before.flatMap((entry, i) =>
			droppedKeys(entry, after[i], `${path}[${i}]`),
		);
	}
	if (before === null || typeof before !== "object") return [];
	if (after === null || typeof after !== "object") return [path];
	return Object.entries(before).flatMap(([key, value]) => {
		const child = path ? `${path}.${key}` : key;
		if (!(key in after)) return [child];
		return droppedKeys(value, after[key], child);
	});
}

/**
 * Foundry requires ids to be exactly 16 alphanumeric characters. A shorter
 * hand-authored id only draws a console warning — the document still loads — so
 * these are counted separately from schema errors, and swapped for a valid
 * placeholder before validation so they don't mask real problems.
 * @param {object} scene  Mutated in place
 * @returns {string[]}
 */
function takeMalformedIds(scene) {
	const malformed = [];
	if (!VALID_ID.test(scene._id ?? "")) {
		malformed.push(`_id "${scene._id}"`);
		scene._id = PLACEHOLDER_ID;
	}
	for (const collection of EMBEDDED) {
		const docs = scene[collection];
		if (!Array.isArray(docs)) continue;
		const bad = docs.filter((doc) => !VALID_ID.test(doc?._id ?? ""));
		for (const [i, doc] of bad.entries()) {
			// Unique placeholders; duplicate ids in a collection are their own error.
			doc._id = `${PLACEHOLDER_ID.slice(0, 12)}${String(i).padStart(4, "0")}`;
		}
		if (bad.length) malformed.push(`${collection} ×${bad.length}`);
	}
	return malformed;
}

function sceneFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) files.push(...sceneFiles(full));
		else if (entry.endsWith(".json")) files.push(full);
	}
	return files;
}

let failures = 0;
let dropWarnings = 0;
let idWarnings = 0;

for (const file of sceneFiles(join(rootDir, "src", "scenes"))) {
	const shortPath = relative(rootDir, file);
	const source = JSON.parse(readFileSync(file, "utf-8"));

	// Source scenes name their folder; buildCompendia swaps in the generated
	// Folder id. Stand one in so the field validates the way the pack will.
	if (typeof source.folder === "string" && !VALID_ID.test(source.folder)) {
		source.folder = PLACEHOLDER_ID;
	}

	const malformedIds = takeMalformedIds(source);
	const notes = [];
	if (malformedIds.length) {
		idWarnings += 1;
		notes.push(`malformed ids — ${malformedIds.join(", ")}`);
	}

	let scene;
	try {
		scene = new BaseScene(structuredClone(source), { strict: true });
	} catch (error) {
		failures += 1;
		console.error(
			`✗ ${shortPath}\n    ${error.message.replaceAll("\n", "\n    ")}`,
		);
		continue;
	}

	const dropped = droppedKeys(source, scene.toObject()).filter(
		(key) => !key.startsWith("_stats."),
	);
	if (dropped.length) {
		dropWarnings += 1;
		// Collapse walls[0].x, walls[1].x, … into one line per field.
		const byField = new Map();
		for (const key of dropped) {
			const field = key.replaceAll(/\[\d+\]/g, "[]");
			byField.set(field, (byField.get(field) ?? 0) + 1);
		}
		const summary = [...byField]
			.map(([field, count]) => (count > 1 ? `${field} ×${count}` : field))
			.join(", ");
		notes.push(`dropped: ${summary}`);
	}

	console.log(
		`${notes.length ? "⚠" : "✓"} ${shortPath} — ${scene.name}` +
			notes.map((n) => `\n    ${n}`).join(""),
	);
}

console.log(
	`\nsrc/scenes — ${failures} schema errors, ${dropWarnings} scenes dropping keys, ` +
		`${idWarnings} scenes with malformed ids (warn-only).`,
);

/* ------------------------------------------------------------------ */
/*  Pack verification                                                  */
/* ------------------------------------------------------------------ */

// Mirrors the sublevel layout written by buildCompendia.
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

const packPath = join(rootDir, "packs", "scenes");
if (!existsSync(join(packPath, "CURRENT"))) {
	console.log("\nNo built pack at packs/scenes — run `npm run build` to verify it too.");
	process.exit(failures ? 1 : 0);
}

const db = new ClassicLevel(packPath, { keyEncoding: "utf8", valueEncoding: "json" });
const sublevels = new Map();
const sublevelFor = (name) => {
	if (!sublevels.has(name)) {
		sublevels.set(name, db.sublevel(name, { keyEncoding: "utf8", valueEncoding: "json" }));
	}
	return sublevels.get(name);
};

/**
 * Replace each id array on a stored record with the documents themselves, the
 * way Foundry's `expandEmbedded` does. A collection the build left inline shows
 * up here as a miss, because an object cannot be looked up as a key.
 * @param {object} doc
 * @param {string} sublevelName
 * @param {string} key
 * @param {object} hierarchy
 * @param {string[]} problems
 */
async function expandEmbedded(doc, sublevelName, key, hierarchy, problems) {
	for (const [collection, childHierarchy] of Object.entries(hierarchy)) {
		const ids = doc[collection];
		if (!Array.isArray(ids)) continue;
		const childSublevel = `${sublevelName}.${collection}`;
		const expanded = [];
		for (const id of ids) {
			if (typeof id !== "string") {
				problems.push(`${collection} stored inline rather than as an id`);
				continue;
			}
			const child = await sublevelFor(childSublevel).get(`${key}.${id}`);
			if (child === undefined) {
				problems.push(`${collection}/${id} missing from ${childSublevel}`);
				continue;
			}
			await expandEmbedded(child, childSublevel, `${key}.${id}`, childHierarchy, problems);
			expanded.push(child);
		}
		doc[collection] = expanded;
	}
}

console.log(`\nVerifying built pack at packs/scenes`);
let packFailures = 0;
let packScenes = 0;
const folderIds = new Set(
	(await sublevelFor("folders").values().all()).map((f) => f._id),
);

for await (const record of sublevelFor("scenes").values()) {
	packScenes += 1;
	const problems = [];
	await expandEmbedded(record, "scenes", record._id, SCENE_HIERARCHY, problems);

	if (record.folder && !folderIds.has(record.folder)) {
		problems.push(`folder ${record.folder} is not in the pack`);
	}

	takeMalformedIds(record);
	if (record.folder) record.folder = PLACEHOLDER_ID;

	try {
		new BaseScene(structuredClone(record), { strict: true });
	} catch (error) {
		problems.push(error.message.replaceAll("\n", "\n      "));
	}

	if (problems.length) {
		packFailures += 1;
		console.error(`✗ ${record.name}\n    ${problems.join("\n    ")}`);
	}
}
await db.close();

console.log(
	`\npacks/scenes — ${packScenes} scenes read back, ${packFailures} with problems.`,
);
console.log(`\nValidated against Foundry ${appVersion}.`);
process.exit(failures || packFailures ? 1 : 0);
