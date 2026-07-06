/**
 * Nimble Maps Module
 * Handles importing actors from compendiums when scenes are added to the world
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
 * Import actors referenced by tokens and update the scene's token data
 * @param {Scene} scene - The created scene document
 * @param {object} options - Creation options
 * @param {string} userId - The user ID who created the scene
 */
async function onCreateScene(scene, options, userId) {
	// Only run for the user who created the scene
	if (game.user.id !== userId) return;

	// Check if this scene came from a compendium
	// (v12+: _stats.compendiumSource; legacy: flags.core.sourceId)
	const sourceId =
		scene._stats?.compendiumSource ?? scene.flags?.core?.sourceId;
	if (!sourceId?.startsWith("Compendium.nimble-maps")) return;

	const tokens = scene.tokens.contents;
	if (!tokens.length) return;

	// Collect unique actor UUIDs that need to be imported
	const actorUuidsToImport = new Set();

	for (const token of tokens) {
		const actorSourceId = tokenActorUuid(token);
		if (!actorSourceId?.startsWith("Compendium.")) continue;

		// Skip if token already has a valid actorId
		if (token.actorId && game.actors.get(token.actorId)) continue;

		actorUuidsToImport.add(actorSourceId);
	}

	if (!actorUuidsToImport.size) return;

	// Import actors from compendium
	const importedActors = new Map();
	let folder = null;

	for (const uuid of actorUuidsToImport) {
		try {
			// Check if actor already exists in world (by provenance)
			const existingActor = game.actors.find(
				(a) =>
					a._stats?.compendiumSource === uuid ||
					a.flags?.core?.sourceId === uuid,
			);

			if (existingActor) {
				importedActors.set(uuid, existingActor.id);
				continue;
			}

			// Fetch actor from compendium
			const compendiumActor = await fromUuid(uuid);
			if (!compendiumActor) {
				console.warn(`${MODULE_ID} | Could not find actor: ${uuid}`);
				continue;
			}

			// Import actor to world, filed into the module's folder,
			// with provenance stamped for future dedup
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

	if (!importedActors.size) return;

	// Update tokens with the imported actor IDs
	const tokenUpdates = [];

	for (const token of tokens) {
		const actorSourceId = tokenActorUuid(token);
		const newActorId = importedActors.get(actorSourceId);

		if (newActorId && token.actorId !== newActorId) {
			tokenUpdates.push({
				_id: token.id,
				actorId: newActorId,
			});
		}
	}

	if (tokenUpdates.length) {
		await scene.updateEmbeddedDocuments("Token", tokenUpdates);
		console.log(
			`${MODULE_ID} | Updated ${tokenUpdates.length} tokens with actor references`,
		);
	}
}

// Register hooks when the module is ready
Hooks.once("ready", () => {
	console.log(`${MODULE_ID} | Initializing Nimble Maps`);
});

Hooks.on("createScene", onCreateScene);
