/**
 * Nimble Maps Module
 * Imports the actors referenced by scene tokens from the nimble system
 * compendia, files them in a folder, and links the tokens — both when a
 * scene is first added to the world and as a repair sweep at world load.
 */

const MODULE_ID = "nimble-maps";
const ACTOR_FOLDER_NAME = "Nimble GM Guide";

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
 * Find or create the Actor folder that imported actors are filed into.
 * @returns {Promise<Folder>}
 */
async function getActorFolder() {
	const existing = game.folders.find(
		(f) => f.type === "Actor" && f.name === ACTOR_FOLDER_NAME,
	);
	if (existing) return existing;
	return Folder.create({
		name: ACTOR_FOLDER_NAME,
		type: "Actor",
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

	const actorUuids = new Set(brokenTokens.map((t) => tokenActorUuid(t)));
	const importedActors = new Map();
	let folder = null;

	for (const uuid of actorUuids) {
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

			folder ??= await getActorFolder();
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
	await importActorsForScene(scene);
}

// Repair sweep: fix any previously-imported scenes with dangling tokens
// (e.g. scenes dragged in while the module was disabled or broken).
Hooks.once("ready", async () => {
	console.log(`${MODULE_ID} | Initializing Nimble Maps`);
	if (!game.user.isGM) return;
	let repaired = 0;
	for (const scene of game.scenes) {
		repaired += await importActorsForScene(scene);
	}
	if (repaired) {
		ui.notifications.info(
			`Nimble Maps: relinked ${repaired} tokens to their actors.`,
		);
	}
});

Hooks.on("createScene", onCreateScene);
