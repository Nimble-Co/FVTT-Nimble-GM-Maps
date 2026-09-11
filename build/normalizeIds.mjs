/**
 * Pad every malformed document id in src/scenes up to Foundry's required 16
 * alphanumeric characters.
 *
 * Foundry only warns about a short id rather than refusing the document, which
 * is why these survived — but it warns once per document on every world load,
 * and an invalid id is a document Foundry is entitled to start rejecting.
 *
 * Ids are padded rather than regenerated so they stay readable ("encwall0000" ->
 * "encwall000000000"): these were hand-authored to be greppable and that is
 * worth keeping. Padding can in principle collide ("light1" and "light10" both
 * pad into the same string), so uniqueness is re-checked per scope afterwards
 * and a collision falls back to a random id.
 *
 *   node build/normalizeIds.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = join(rootDir, "src", "scenes");

const VALID_ID = /^[A-Za-z0-9]{16}$/;
const ID_LENGTH = 16;
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Collections whose ids are padded. `levels` is deliberately absent: its id is
// Foundry's own `defaultLevel0000`, which is already valid and is referenced by
// Scene#initialLevel and by every token's `level`.
const COLLECTIONS = [
	"drawings",
	"lights",
	"notes",
	"regions",
	"sounds",
	"tiles",
	"tokens",
	"walls",
];

const dryRun = process.argv.includes("--dry-run");

function randomId() {
	let id = "";
	for (let i = 0; i < ID_LENGTH; i += 1) {
		id += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
	}
	return id;
}

/**
 * Pad an id to 16 characters, or mint a fresh one if it cannot be salvaged.
 * @param {unknown} id
 * @param {Set<string>} taken  Ids already used in this scope
 * @returns {string}
 */
function normalizeId(id, taken) {
	let next =
		typeof id === "string" && /^[A-Za-z0-9]+$/.test(id) && id.length < ID_LENGTH
			? id.padEnd(ID_LENGTH, "0")
			: randomId();
	while (taken.has(next)) next = randomId();
	taken.add(next);
	return next;
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

const files = sceneFiles(scenesDir);
const sceneIds = new Set();
const renames = [];

// Reserve the ids that are already valid so padding can never land on one.
for (const file of files) {
	const scene = JSON.parse(readFileSync(file, "utf-8"));
	if (VALID_ID.test(scene._id ?? "")) sceneIds.add(scene._id);
}

let changedFiles = 0;

for (const file of files) {
	const before = readFileSync(file, "utf-8");
	const scene = JSON.parse(before);
	const shortPath = relative(rootDir, file);
	const changes = [];

	if (!VALID_ID.test(scene._id ?? "")) {
		const from = scene._id;
		scene._id = normalizeId(from, sceneIds);
		changes.push(`_id ${from} -> ${scene._id}`);
		renames.push({ file: shortPath, from, to: scene._id });
	}

	for (const collection of COLLECTIONS) {
		const docs = scene[collection];
		if (!Array.isArray(docs) || !docs.length) continue;

		const taken = new Set(
			docs.map((doc) => doc?._id).filter((id) => VALID_ID.test(id ?? "")),
		);
		let fixed = 0;
		for (const doc of docs) {
			if (VALID_ID.test(doc?._id ?? "")) continue;
			doc._id = normalizeId(doc._id, taken);
			fixed += 1;
		}
		if (fixed) changes.push(`${collection} x${fixed}`);
	}

	if (!changes.length) continue;

	changedFiles += 1;
	console.log(`  ${scene.name}\n    ${changes.join("\n    ")}`);
	if (!dryRun) {
		writeFileSync(file, `${JSON.stringify(scene, null, "\t")}\n`);
	}
}

console.log(
	`\n${dryRun ? "[dry run] " : ""}${changedFiles} scene files updated, ${renames.length} scene ids changed.`,
);
if (renames.length) {
	console.log(
		"\nScene ids changed — a world that imported the old pack keeps a stale\n" +
			"_stats.compendiumSource. Nothing in this repo or the Nimble system\n" +
			"references these ids, and sync:scene falls back to matching by name.",
	);
}
