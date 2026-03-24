/**
 * Merge walls, lights, and tokens from Scene Packer export into existing scene JSON files
 * Only replaces data where it exists in the source
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

const GOLDEN_THREAD_SCENE_PATH = "./golden-thread-nimble-data/data/Scene.json";
const SRC_SCENES_PATH = "./src/scenes";

// Load the Scene Packer export
const scenePackerData = JSON.parse(readFileSync(GOLDEN_THREAD_SCENE_PATH, "utf-8"));

// Create a map of scene names to their data (lowercase for matching)
const sceneDataMap = new Map();
for (const scene of scenePackerData) {
	const normalizedName = scene.name.toLowerCase().trim();
	sceneDataMap.set(normalizedName, scene);
}

console.log(`Loaded ${scenePackerData.length} scenes from Scene Packer export`);
console.log("Scene names:", [...sceneDataMap.keys()].join(", "));

// Find all scene JSON files in src/scenes
function findSceneFiles(dir) {
	const files = [];
	const entries = readdirSync(dir);

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...findSceneFiles(fullPath));
		} else if (entry.endsWith(".json")) {
			files.push(fullPath);
		}
	}

	return files;
}

const sceneFiles = findSceneFiles(SRC_SCENES_PATH);
console.log(`\nFound ${sceneFiles.length} scene files to process\n`);

let updatedCount = 0;
let skippedCount = 0;

for (const filePath of sceneFiles) {
	const existingScene = JSON.parse(readFileSync(filePath, "utf-8"));
	const sceneName = existingScene.name.toLowerCase().trim();

	// Try to find a matching scene in the Scene Packer data
	let matchedScene = sceneDataMap.get(sceneName);

	// If no exact match, try partial matching
	if (!matchedScene) {
		for (const [name, scene] of sceneDataMap) {
			if (
				name.includes(sceneName) ||
				sceneName.includes(name) ||
				// Handle variations like "Goblin Encampment" matching "A Tiny Rescue - Goblin Encampment"
				name.split(" - ").some((part) => part.toLowerCase().trim() === sceneName) ||
				sceneName.split(" - ").some((part) => name.includes(part.toLowerCase().trim()))
			) {
				matchedScene = scene;
				break;
			}
		}
	}

	if (!matchedScene) {
		console.log(`⏭️  No match found for: ${existingScene.name}`);
		skippedCount++;
		continue;
	}

	let updated = false;
	const updates = [];

	// Replace walls if they exist in source
	if (matchedScene.walls && matchedScene.walls.length > 0) {
		existingScene.walls = matchedScene.walls;
		updates.push(`walls (${matchedScene.walls.length})`);
		updated = true;
	}

	// Replace lights if they exist in source
	if (matchedScene.lights && matchedScene.lights.length > 0) {
		existingScene.lights = matchedScene.lights;
		updates.push(`lights (${matchedScene.lights.length})`);
		updated = true;
	}

	// Replace tokens if they exist in source
	if (matchedScene.tokens && matchedScene.tokens.length > 0) {
		existingScene.tokens = matchedScene.tokens;
		updates.push(`tokens (${matchedScene.tokens.length})`);
		updated = true;
	}

	// Also copy environment settings if they exist
	if (matchedScene.environment) {
		existingScene.environment = matchedScene.environment;
		updates.push("environment");
		updated = true;
	}

	if (updated) {
		writeFileSync(filePath, JSON.stringify(existingScene, null, 2) + "\n");
		console.log(`✅ Updated ${existingScene.name}: ${updates.join(", ")}`);
		updatedCount++;
	} else {
		console.log(`⏭️  No walls/lights/tokens in source for: ${existingScene.name}`);
		skippedCount++;
	}
}

console.log(`\n✨ Done! Updated ${updatedCount} scenes, skipped ${skippedCount}`);
