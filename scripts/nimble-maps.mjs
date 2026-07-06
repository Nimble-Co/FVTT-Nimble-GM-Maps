/**
 * Nimble Maps Module
 * Imports the actors referenced by scene tokens from the nimble system
 * compendia, files them in a folder, and links the tokens — both when a
 * scene is first added to the world and as a repair sweep at world load.
 */

const MODULE_ID = "nimble-maps";
const ACTOR_FOLDER_NAME = "Nimble GM Guide Creatures";

/**
 * Get the compendium actor UUID referenced by a token.
 * Primary: module-namespaced flag (never touched by core migrations).
 * Fallback: legacy flags.core.sourceId.
 * @param {TokenDocument} token
 * @returns {string|undefined}
 */
function tokenActorUuid(token) {
	return token.flags?.[MODULE_ID]?.actorUuid ?? token.flags?.core?.sourceId;
}

/**
 * Imports run strictly one at a time through this chain. A folder drag
 * fires createScene for every scene almost simultaneously; unserialized,
 * each import races the "does the folder exist yet?" check and creates
 * duplicate folders.
 */
let importChain = Promise.resolve();

/**
 * @param {() => Promise<number>} job
 * @returns {Promise<number>}
 */
function enqueue(job) {
	const run = importChain.then(job);
	importChain = run.catch((error) => {
		console.error(`${MODULE_ID} | import failed:`, error);
		return 0;
	});
	return run;
}

/**
 * Merge duplicate parent/adventure folders created by earlier versions
 * (or a mid-drag crash) back into a single folder tree.
 * @returns {Promise<void>}
 */
async function consolidateFolders() {
	const parents = game.folders.filter(
		(f) => f.type === "Actor" && f.name === ACTOR_FOLDER_NAME && !f.folder,
	);
	if (parents.length <= 1) return;
	const keeper = parents[0];
	for (const extra of parents.slice(1)) {
		const children = game.folders.filter(
			(f) => f.type === "Actor" && f.folder?.id === extra.id,
		);
		for (const child of children) {
			const target = game.folders.find(
				(f) =>
					f.type === "Actor" &&
					f.name === child.name &&
					f.folder?.id === keeper.id,
			);
			if (target) {
				const moves = game.actors
					.filter((a) => a.folder?.id === child.id)
					.map((a) => ({ _id: a.id, folder: target.id }));
				if (moves.length) await Actor.updateDocuments(moves);
				await child.delete();
			} else {
				await child.update({ folder: keeper.id });
			}
		}
		const strays = game.actors
			.filter((a) => a.folder?.id === extra.id)
			.map((a) => ({ _id: a.id, folder: keeper.id }));
		if (strays.length) await Actor.updateDocuments(strays);
		await extra.delete();
		console.log(
			`${MODULE_ID} | merged duplicate "${ACTOR_FOLDER_NAME}" folder`,
		);
	}
}

/**
 * Find or create the parent Actor folder that imported actors are filed into.
 * @returns {Promise<Folder>}
 */
async function getActorFolder() {
	const existing = game.folders.find(
		(f) =>
			f.type === "Actor" && f.name === ACTOR_FOLDER_NAME && !f.folder,
	);
	if (existing) return existing;
	return Folder.create({
		name: ACTOR_FOLDER_NAME,
		type: "Actor",
		color: "#4a6741",
	});
}

/**
 * Find or create the per-adventure subfolder under the parent folder.
 * @param {Folder} parent
 * @param {string} adventure - Adventure name from the token flag
 * @returns {Promise<Folder>}
 */
async function getAdventureFolder(parent, adventure) {
	if (!adventure) return parent;
	const existing = game.folders.find(
		(f) =>
			f.type === "Actor" &&
			f.name === adventure &&
			f.folder?.id === parent.id,
	);
	if (existing) return existing;
	return Folder.create({
		name: adventure,
		type: "Actor",
		folder: parent.id,
		color: "#4a6741",
	});
}

/**
 * Import any missing actors referenced by a scene's tokens and link the
 * tokens to them. Safe to call repeatedly — already-linked tokens and
 * already-imported actors are skipped.
 * @param {Scene} scene
 * @returns {Promise<number>} number of tokens updated
 */
async function importActorsForScene(scene) {
	const tokens = scene.tokens.contents;
	if (!tokens.length) return 0;

	// Tokens that carry our actor reference but don't resolve to a world actor
	const brokenTokens = tokens.filter((token) => {
		const uuid = tokenActorUuid(token);
		if (!uuid?.startsWith("Compendium.")) return false;
		return !(token.actorId && game.actors.get(token.actorId));
	});
	if (!brokenTokens.length) return 0;

	// uuid -> adventure name (from the first token referencing it)
	const actorUuids = new Map();
	for (const t of brokenTokens) {
		const uuid = tokenActorUuid(t);
		if (!actorUuids.has(uuid)) {
			actorUuids.set(uuid, t.flags?.[MODULE_ID]?.adventure ?? null);
		}
	}
	const importedActors = new Map();
	let parentFolder = null;

	for (const [uuid, adventure] of actorUuids) {
		try {
			// Reuse an actor previously imported from this compendium entry
			const existingActor = game.actors.find(
				(a) =>
					a._stats?.compendiumSource === uuid ||
					a.flags?.core?.sourceId === uuid,
			);
			if (existingActor) {
				importedActors.set(uuid, existingActor.id);
				continue;
			}

			const compendiumActor = await fromUuid(uuid);
			if (!compendiumActor) {
				console.warn(`${MODULE_ID} | Could not find actor: ${uuid}`);
				continue;
			}

			parentFolder ??= await getActorFolder();
			const folder = await getAdventureFolder(parentFolder, adventure);
			const actorData = compendiumActor.toObject();
			actorData._stats = { ...actorData._stats, compendiumSource: uuid };
			actorData.folder = folder.id;
			const importedActor = await Actor.create(actorData);
			if (importedActor) {
				importedActors.set(uuid, importedActor.id);
				console.log(
					`${MODULE_ID} | Imported actor: ${importedActor.name} (${importedActor.id})`,
				);
			}
		} catch (error) {
			console.error(`${MODULE_ID} | Error importing actor ${uuid}:`, error);
		}
	}

	if (!importedActors.size) return 0;

	const tokenUpdates = [];
	for (const token of brokenTokens) {
		const newActorId = importedActors.get(tokenActorUuid(token));
		if (newActorId && token.actorId !== newActorId) {
			tokenUpdates.push({ _id: token.id, actorId: newActorId });
		}
	}

	if (tokenUpdates.length) {
		await scene.updateEmbeddedDocuments("Token", tokenUpdates);
		console.log(
			`${MODULE_ID} | ${scene.name}: linked ${tokenUpdates.length} tokens to world actors`,
		);
	}
	return tokenUpdates.length;
}

/**
 * When any scene is created (single drag, folder drag, adventure import,
 * macro — any path), import and link its actors. Gated by the tokens
 * themselves carrying our module flag, not by scene provenance, because
 * folder drops don't stamp _stats.compendiumSource.
 */
async function onCreateScene(scene, options, userId) {
	if (game.user.id !== userId) return;
	await enqueue(() => importActorsForScene(scene));
}

// Repair sweep: merge any duplicated folders, then fix previously-imported
// scenes with dangling tokens (e.g. scenes dragged in while the module was
// disabled or broken).
Hooks.once("ready", async () => {
	console.log(`${MODULE_ID} | Initializing Nimble Maps`);
	if (!game.user.isGM) return;
	await enqueue(async () => {
		await consolidateFolders();
		return 0;
	});
	let repaired = 0;
	for (const scene of game.scenes) {
		repaired += await enqueue(() => importActorsForScene(scene));
	}
	if (repaired) {
		ui.notifications.info(
			`Nimble Maps: relinked ${repaired} tokens to their actors.`,
		);
	}
});

Hooks.on("createScene", onCreateScene);
