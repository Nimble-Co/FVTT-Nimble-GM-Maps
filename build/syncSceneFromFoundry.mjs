/**
 * Sync a single scene's data from a running Foundry VTT instance back into the
 * module source scene JSON.
 *
 * Workflow:
 *   1. Edit the scene live in Foundry (walls, doors, lights, whatever).
 *   2. Get the scene data out of Foundry (see options below).
 *   3. Run:  node build/syncSceneFromFoundry.mjs <exported.json> [flags]
 *
 * Getting data out of Foundry (pick one):
 *   A. Sidebar → right-click the scene → "Export Data". Saves
 *      fvtt-Scene-<name>.json to your Downloads folder.
 *   B. Run a Script macro (or paste in the F12 console) while the scene is active:
 *        game.clipboard.copyPlainText(JSON.stringify(canvas.scene.toObject(), null, 2));
 *      then paste into a file. (Console-only alternative: copy(canvas.scene.toObject()); )
 *
 * By default only WALLS are synced (that's the usual thing you're hand-editing).
 * Add flags to sync more collections:
 *   --lights --tokens --drawings --notes --sounds --tiles --templates --environment
 *   --all         sync every collection above
 *   --dry-run     report what would change without writing
 *
 * Matching: the exported scene is matched to a source file by `_id` first, then
 * by normalized name. The source file's own `_id`, `name`, `folder`, background,
 * grid, etc. are always preserved — only the selected collections are replaced.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC_SCENES_PATH = "./src/scenes";

const COLLECTIONS = [
	"walls",
	"lights",
	"tokens",
	"drawings",
	"notes",
	"sounds",
	"tiles",
	"templates",
];

// ---- parse args ----------------------------------------------------------
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const exportPath = positional[0];

if (!exportPath) {
	console.error("Usage: node build/syncSceneFromFoundry.mjs <exported-scene.json> [--walls] [--lights] [--tokens] [--all] [--dry-run]");
	process.exit(1);
}

const dryRun = flags.has("--dry-run");
const syncAll = flags.has("--all");

// Which collections to sync. Default: walls only.
const selected = COLLECTIONS.filter((c) => syncAll || flags.has(`--${c}`));
if (!selected.includes("walls") && !flags.has("--no-walls")) selected.unshift("walls");
const syncEnvironment = syncAll || flags.has("--environment");

// ---- load the export -----------------------------------------------------
let raw;
try {
	raw = JSON.parse(readFileSync(exportPath, "utf-8"));
} catch (err) {
	console.error(`Could not read/parse ${exportPath}: ${err.message}`);
	process.exit(1);
}

// Accept: a single scene object, an array of scenes (use the first / only one),
// or a wrapper with a `scenes` array.
function extractScene(data) {
	if (Array.isArray(data)) {
		if (data.length === 1) return data[0];
		throw new Error(`Export contains ${data.length} scenes; export a single scene at a time.`);
	}
	if (data && Array.isArray(data.scenes) && data.scenes.length === 1) return data.scenes[0];
	return data;
}

const exported = extractScene(raw);
if (!exported || typeof exported !== "object") {
	console.error("Export did not contain a recognizable scene object.");
	process.exit(1);
}

// ---- find the matching source file --------------------------------------
function findSceneFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) files.push(...findSceneFiles(full));
		else if (entry.endsWith(".json")) files.push(full);
	}
	return files;
}

const norm = (s) => (s ?? "").toLowerCase().trim();
const sceneFiles = findSceneFiles(SRC_SCENES_PATH).map((f) => ({
	path: f,
	scene: JSON.parse(readFileSync(f, "utf-8")),
}));

// When a scene is imported/dragged from a compendium into a world, Foundry gives
// the world copy a NEW random _id, but records the original compendium id here.
// The trailing segment is the source scene's _id (e.g. ...scenes.Scene.ATR002ValleyGnd).
function originId(scene) {
	const uuid = scene?.flags?.core?.sourceId ?? scene?._stats?.compendiumSource;
	if (typeof uuid === "string" && uuid.startsWith("Compendium.")) {
		return uuid.split(".").pop();
	}
	return null;
}

const wantOrigin = originId(exported);
let targetPath = null;
let targetScene = null;
let matchedBy = null;

// 1) match by compendium origin id (survives dragging into a world) — most reliable
if (wantOrigin) {
	const hit = sceneFiles.find((f) => f.scene._id === wantOrigin);
	if (hit) { ({ path: targetPath, scene: targetScene } = hit); matchedBy = `compendium source id ${wantOrigin}`; }
}

// 2) match by top-level _id (works when you edited the scene directly in the compendium)
if (!targetScene && exported._id) {
	const hit = sceneFiles.find((f) => f.scene._id === exported._id);
	if (hit) { ({ path: targetPath, scene: targetScene } = hit); matchedBy = `_id ${exported._id}`; }
}

// 3) fall back to exact normalized name
if (!targetScene && exported.name) {
	const hit = sceneFiles.find((f) => norm(f.scene.name) === norm(exported.name));
	if (hit) { ({ path: targetPath, scene: targetScene } = hit); matchedBy = `name "${exported.name}"`; }
}

if (!targetScene) {
	console.error(`No source scene matched export (origin=${wantOrigin ?? "?"}, id=${exported._id ?? "?"}, name=${exported.name ?? "?"}).`);
	console.error("Source scenes:");
	for (const f of sceneFiles) {
		console.error(`  ${f.scene._id}  ${f.scene.name}`);
	}
	process.exit(1);
}

console.log(`Matched export → ${targetScene.name}  (${targetPath})`);
console.log(`  via ${matchedBy}`);

// ---- merge selected collections -----------------------------------------
const changes = [];
for (const key of selected) {
	const incoming = exported[key];
	if (!Array.isArray(incoming)) {
		console.log(`  · ${key}: not present in export, leaving source unchanged`);
		continue;
	}
	const before = Array.isArray(targetScene[key]) ? targetScene[key].length : 0;
	targetScene[key] = incoming;
	changes.push(`${key} ${before}→${incoming.length}`);
}

if (syncEnvironment && exported.environment) {
	targetScene.environment = exported.environment;
	changes.push("environment");
}

if (!changes.length) {
	console.log("Nothing to sync (no selected collections found in export).");
	process.exit(0);
}

console.log(`  ${changes.join(", ")}`);

if (dryRun) {
	console.log("--dry-run: no files written.");
	process.exit(0);
}

// Preserve the repo convention: tab indentation + trailing newline.
writeFileSync(targetPath, JSON.stringify(targetScene, null, "\t") + "\n");
console.log(`✅ Wrote ${targetPath}`);
console.log("Next: rebuild the pack →  node build/buildCompendia.mjs");
