/**
 * Migrate src/scenes/*.json from the Foundry v13 Scene schema to the native v14
 * schema, so the built compendium ships data Foundry never has to migrate.
 *
 * Each step mirrors the equivalent function in Foundry's own migration registry
 * (dist/database/documents/{scene,token,tile}.mjs). Scenes are stamped with
 * `_stats.coreVersion` so those registered migrations are skipped at load —
 * without the stamp Foundry re-runs every migration from v10 onward on each
 * world start, and `migrateLevels` would overwrite the `levels` array we build
 * here.
 *
 * Idempotent: the Level reshape is skipped for a scene that already carries
 * `levels`, while the field normalization below is safe to re-run.
 *
 *   node build/migrateScenesToV14.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = join(rootDir, "src", "scenes");
const moduleJson = JSON.parse(
	readFileSync(join(rootDir, "module.json"), "utf-8"),
);

// Scene.metadata.defaultLevelId — the id Foundry's own migrateLevels assigns to
// the Level it synthesizes for a pre-v14 scene.
const DEFAULT_LEVEL_ID = "defaultLevel0000";

// Stamped onto every scene. Must be >= the highest schemaVersion among Scene and
// its embedded documents (Level, at 14.364) or Foundry flags the record dirty and
// rewrites the pack on load.
const CORE_VERSION = moduleJson.compatibility.minimum;

const FOG_EXPLORATION_MODES = { DISABLED: 0, INDIVIDUAL: 1 };
const OCCLUSION_MODES = { NONE: 0, FADE: 1, SURFACE: 2, RADIAL: 4, VISION: 8 };
const TOKEN_SHAPES = { RECTANGLE_1: 4 };
const PLACEHOLDER_AUTHOR_ID = "0000000000000000";

const dryRun = process.argv.includes("--dry-run");

/**
 * Build the Level document that carries the scene's background, foreground and
 * fog overlay. Mirrors `migrateLevels` (Scene, 14.353), plus the background
 * texture transforms that Foundry's `_LEVELS_PROPERTY_MAP` assigns to
 * `Level#textures` but `migrateLevels` itself drops.
 * @param {object} scene
 * @returns {object}
 */
function buildLevel(scene) {
	const background = scene.background ?? {};
	const level = { _id: DEFAULT_LEVEL_ID, name: scene.name, background: {} };

	if (scene.backgroundColor) level.background.color = scene.backgroundColor;
	if (background.src) level.background.src = background.src;
	if (background.tint) level.background.tint = background.tint;
	if (scene.foreground) level.foreground = { src: scene.foreground };
	if (scene.foregroundElevation != null) {
		level.elevation = { top: scene.foregroundElevation };
	}
	if (scene.fogOverlay) level.fog = { src: scene.fogOverlay };

	// Only emit `textures` when the background is actually transformed; the
	// schema defaults cover the identity case.
	const textures = {};
	if (background.scaleX != null && background.scaleX !== 1) {
		textures.scaleX = background.scaleX;
	}
	if (background.scaleY != null && background.scaleY !== 1) {
		textures.scaleY = background.scaleY;
	}
	if (background.rotation) textures.rotation = background.rotation;
	if (background.fit && background.fit !== "fill") textures.fit = background.fit;
	if (Object.keys(textures).length) level.textures = textures;

	return level;
}

/**
 * Collapse the flat v11 fog fields into the `fog` schema and convert the
 * exploration boolean to a mode. Mirrors `migrateFog` (v12) and
 * `migrateFogExploration` (14.353).
 * @param {object} scene
 * @returns {object}
 */
function buildFog(scene) {
	const fog = {
		mode: scene.fogExploration
			? FOG_EXPLORATION_MODES.INDIVIDUAL
			: FOG_EXPLORATION_MODES.DISABLED,
	};
	const colors = {};
	if (scene.fogExploredColor) colors.explored = scene.fogExploredColor;
	if (scene.fogUnexploredColor) colors.unexplored = scene.fogUnexploredColor;
	if (Object.keys(colors).length) fog.colors = colors;
	return fog;
}

/**
 * Mirrors `migrateDepthAndLevel` (Token, 14.353) and `migrateDetectionModes`
 * (Token, 14.352), plus `migrateHexagonalTokenShapes` (v13) which these square-
 * grid scenes never had applied to their source.
 * @param {object} token
 */
function migrateToken(token) {
	token.depth = Math.min(token.width ?? 1, token.height ?? 1);
	token.level = DEFAULT_LEVEL_ID;

	// v14 stores detection modes as an object keyed by mode id.
	if (Array.isArray(token.detectionModes)) {
		token.detectionModes = Object.fromEntries(
			token.detectionModes.map(({ id, ...rest }) => [id, rest]),
		);
	}

	// Square-grid scenes: shape is always the plain rectangle.
	if (token.shape == null) token.shape = TOKEN_SHAPES.RECTANGLE_1;
	delete token.hexagonalShape;

	// An empty delta object is not a valid ActorDelta reference. Linked tokens
	// carry no delta at all; Foundry nulls it on create either way.
	if (token.actorLink && !token.delta?._id) token.delta = null;

	normalizeTexture(token.texture);

	// PrototypeToken fields that were never part of a placed TokenDocument.
	delete token.appendNumber;
	delete token.prependAdjective;
}

/**
 * v14's TextureData dropped offset and rotation — a texture is placed by anchor
 * now. Every value in these scenes is 0, so this discards nothing.
 * @param {object|undefined} texture
 */
function normalizeTexture(texture) {
	if (!texture) return;
	for (const key of ["offsetX", "offsetY", "rotation"]) {
		if (texture[key]) {
			console.warn(
				`    ! texture.${key} = ${texture[key]} has no v14 equivalent and was dropped`,
			);
		}
		delete texture[key];
	}
}

/**
 * Drawing#author is a non-nullable User id. A drawing authored by editing one of
 * Foundry's starter scenes can carry a null, which fails validation outright in
 * v14. Nothing in a compendium can know a real user id, and the field's initial
 * only resolves client-side, so stand in a syntactically valid placeholder — the
 * importing world reassigns ownership anyway.
 * @param {object} drawing
 */
function migrateDrawing(drawing) {
	if (!drawing.author) drawing.author = PLACEHOLDER_AUTHOR_ID;
	normalizeTexture(drawing.texture);
}

/**
 * Mirrors `migratePosition` (Tile, 14.349) and `migrateOcclusionMode`
 * (Tile, 14.355), and drops the `overhead` flag left over from v11. Leaving
 * `overhead` in place makes Foundry's v12 `migrateOverheadTiles` reset the tile
 * elevation to `4 * grid.distance`, discarding the authored value.
 * @param {object} tile
 */
function migrateTile(tile) {
	tile.texture ??= {};

	// v14 positions a tile by its texture anchor. These tiles are unrotated and
	// their x/y are top-left, which is anchor 0 rather than the schema's 0.5.
	if (!tile.rotation) {
		tile.texture.anchorX = 0;
		tile.texture.anchorY = 0;
	} else {
		tile.texture.anchorX ??= 0.5;
		tile.texture.anchorY ??= 0.5;
		tile.x = Math.round((tile.x ?? 0) + tile.width / 2);
		tile.y = Math.round((tile.y ?? 0) + tile.height / 2);
	}

	// Occlusion went from a single enum to a set of bit flags.
	if (tile.occlusion && "mode" in tile.occlusion) {
		const { mode, ...rest } = tile.occlusion;
		tile.occlusion = {
			...rest,
			modes: mode > OCCLUSION_MODES.NONE ? [1 << (mode - 1)] : [],
		};
	}

	normalizeTexture(tile.texture);
	delete tile.overhead;
	delete tile.roof;
}

/**
 * Bring every embedded document up to the v14 schema. Safe to re-run, so it
 * applies to scenes that were already reshaped by an earlier run.
 * @param {object} scene
 */
function normalizeEmbedded(scene) {
	for (const token of scene.tokens ?? []) migrateToken(token);
	for (const tile of scene.tiles ?? []) migrateTile(tile);
	for (const drawing of scene.drawings ?? []) migrateDrawing(drawing);
}

/**
 * Reshape a v13 scene into the v14 source object.
 * @param {object} scene
 * @returns {object}
 */
function reshapeScene(scene) {
	const level = buildLevel(scene);
	const fog = buildFog(scene);
	const background = scene.background ?? {};

	const now = Date.now();
	const migrated = {
		_id: scene._id,
		name: scene.name,
		folder: scene.folder,
		navigation: scene.navigation,
		navOrder: scene.navOrder,
		navName: scene.navName,
		width: scene.width,
		height: scene.height,
		padding: scene.padding,
		// Background offsets are scene-level shift in v14, not part of the Level.
		shiftX: background.offsetX ?? 0,
		shiftY: background.offsetY ?? 0,
		initial: scene.initial,
		initialLevel: DEFAULT_LEVEL_ID,
		grid: scene.grid,
		tokenVision: scene.tokenVision,
		fog,
		environment: scene.environment,
		levels: [level],
		drawings: scene.drawings ?? [],
		tokens: scene.tokens ?? [],
		lights: scene.lights ?? [],
		notes: scene.notes ?? [],
		regions: scene.regions ?? [],
		sounds: scene.sounds ?? [],
		tiles: scene.tiles ?? [],
		walls: scene.walls ?? [],
		flags: scene.flags ?? {},
		_stats: {
			coreVersion: CORE_VERSION,
			systemId: moduleJson.relationships.systems[0].id,
			systemVersion: moduleJson.relationships.systems[0].compatibility.minimum,
			createdTime: now,
			modifiedTime: now,
			lastModifiedBy: null,
			compendiumSource: null,
			duplicateSource: null,
		},
	};

	// Carry through anything the scene set that isn't part of the reshape.
	for (const key of ["playlist", "playlistSound", "journal", "journalEntryPage", "weather", "sort", "ownership", "thumb", "transition"]) {
		if (scene[key] !== undefined) migrated[key] = scene[key];
	}

	return migrated;
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

let reshaped = 0;
let changed = 0;

for (const file of sceneFiles(scenesDir)) {
	const before = readFileSync(file, "utf-8");
	const scene = JSON.parse(before);
	const wasV14 = Array.isArray(scene.levels);

	normalizeEmbedded(scene);
	const migrated = wasV14 ? scene : reshapeScene(scene);
	if (!wasV14) reshaped += 1;

	const after = `${JSON.stringify(migrated, null, "\t")}\n`;
	if (after === before) {
		console.log(`  · ${migrated.name}: already current`);
		continue;
	}

	changed += 1;
	console.log(
		`  ${wasV14 ? "~" : "✓"} ${migrated.name}: level "${migrated.levels[0]._id}", fog.mode ${migrated.fog.mode}, ` +
			`${migrated.tokens.length} tokens, ${migrated.tiles.length} tiles, ${migrated.regions.length} regions`,
	);
	if (!dryRun) writeFileSync(file, after);
}

console.log(
	`\n${dryRun ? "[dry run] " : ""}${changed} scenes written (${reshaped} reshaped from the v13 schema).`,
);
if (!dryRun && changed) {
	console.log("Next: rebuild the pack →  npm run build");
}
