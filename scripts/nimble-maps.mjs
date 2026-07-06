/**
 * Nimble Maps Module
 * Handles importing actors from compendiums when scenes are added to the world
 */

const MODULE_ID = "nimble-maps";

/**
 * Import actors referenced by tokens and update the scene's token data
 * @param {Scene} scene - The created scene document
 * @param {object} options - Creation options
 * @param {string} userId - The user ID who created the scene
 */
async function onCreateScene(scene, options, userId) {
	// Only run for the user who created the scene
	if (game.user.id !== userId) return;

	// Check if this scene came from a compendium (v12+: _stats.compendiumSource; legacy: flags.core.sourceId)
	const sourceId =
		scene._stats?.compendiumSource ?? scene.flags?.core?.sourceId;
	if (!sourceId?.startsWith("Compendium.nimble-maps")) return;

	const tokens = scene.tokens.contents;
	if (!tokens.length) return;

	// Collect unique actor UUIDs that need to be imported
	const actorUuidsToImport = new Map();

	for (const token of tokens) {
		const actorSourceId = token.flags?.core?.sourceId;
		if (!actorSourceId?.startsWith("Compendium.")) continue;

		// Skip if token already has a valid actorId
		if (token.actorId && game.actors.get(token.actorId)) continue;

		actorUuidsToImport.set(actorSourceId, null);
	}

	if (!actorUuidsToImport.size) return;

	// Import actors from compendium
	const importedActors = new Map();

	for (const uuid of actorUuidsToImport.keys()) {
		try {
			// Check if actor already exists in world (by sourceId)
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

			// Import actor to world (stamp provenance for future dedup)
			const actorData = compendiumActor.toObject();
			actorData._stats = { ...actorData._stats, compendiumSource: uuid };
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
		const actorSourceId = token.flags?.core?.sourceId;
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
