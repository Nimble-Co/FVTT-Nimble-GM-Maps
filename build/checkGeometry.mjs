/**
 * Check that every scene's areas line up with the art it is drawn on.
 *
 * The schema validator in build/validateScenes.mjs proves Foundry will load the
 * data; it says nothing about whether the numbers are right. A scene whose
 * width/height disagrees with its background image silently rescales the map, so
 * every hand-traced wall, light and token lands in the wrong place. These checks
 * catch that class of mistake, plus missing art and placeables sitting outside
 * the canvas.
 *
 *   node build/checkGeometry.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = join(rootDir, "src", "scenes");
const MODULE_PREFIX = "modules/nimble-maps/";

/**
 * Read the pixel dimensions out of a WebP file. Covers the three chunk layouts
 * Foundry's own converter emits: simple lossy (VP8), lossless (VP8L) and
 * extended (VP8X).
 * @param {string} file
 * @returns {{width: number, height: number}}
 */
function webpDimensions(file) {
	const buf = readFileSync(file);
	if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
		throw new Error("not a WebP file");
	}
	const chunk = buf.toString("ascii", 12, 16);

	if (chunk === "VP8 ") {
		// 3-byte frame tag, then the 0x9d 0x01 0x2a start code, then 14-bit dims.
		if (buf.readUInt8(23) !== 0x9d || buf.readUInt8(24) !== 0x01 || buf.readUInt8(25) !== 0x2a) {
			throw new Error("bad VP8 start code");
		}
		return {
			width: buf.readUInt16LE(26) & 0x3fff,
			height: buf.readUInt16LE(28) & 0x3fff,
		};
	}

	if (chunk === "VP8L") {
		if (buf.readUInt8(20) !== 0x2f) throw new Error("bad VP8L signature");
		const bits = buf.readUInt32LE(21);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >> 14) & 0x3fff) + 1,
		};
	}

	if (chunk === "VP8X") {
		// 1 flag byte + 3 reserved, then 24-bit little-endian canvas dims minus 1.
		const read24 = (off) => buf.readUInt8(off) | (buf.readUInt8(off + 1) << 8) | (buf.readUInt8(off + 2) << 16);
		return { width: read24(24) + 1, height: read24(27) + 1 };
	}

	throw new Error(`unsupported WebP chunk "${chunk}"`);
}

const dimensionCache = new Map();

/**
 * Resolve a Foundry asset path to a repo file and read its dimensions.
 * @param {string} src
 * @returns {{path: string, exists: boolean, width?: number, height?: number, error?: string}}
 */
function resolveAsset(src) {
	if (!src.startsWith(MODULE_PREFIX)) {
		// Core Foundry art, or another package's — not ours to check.
		return { path: src, exists: true, external: true };
	}
	const file = join(rootDir, src.slice(MODULE_PREFIX.length));
	if (!existsSync(file)) return { path: src, exists: false };
	if (!dimensionCache.has(file)) {
		try {
			dimensionCache.set(file, webpDimensions(file));
		} catch (error) {
			dimensionCache.set(file, { error: error.message });
		}
	}
	return { path: src, exists: true, ...dimensionCache.get(file) };
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

/**
 * Bounding box of a region shape, in scene pixels.
 * @param {object} shape
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
 */
function shapeBounds(shape) {
	if (shape.type === "rectangle") {
		return {
			minX: shape.x,
			minY: shape.y,
			maxX: shape.x + shape.width,
			maxY: shape.y + shape.height,
		};
	}
	if (shape.type === "ellipse") {
		return {
			minX: shape.x - shape.radiusX,
			minY: shape.y - shape.radiusY,
			maxX: shape.x + shape.radiusX,
			maxY: shape.y + shape.radiusY,
		};
	}
	if (shape.type === "polygon" && Array.isArray(shape.points)) {
		const xs = shape.points.filter((_, i) => i % 2 === 0);
		const ys = shape.points.filter((_, i) => i % 2 === 1);
		return {
			minX: Math.min(...xs),
			minY: Math.min(...ys),
			maxX: Math.max(...xs),
			maxY: Math.max(...ys),
		};
	}
	return null;
}

let errors = 0;
let warnings = 0;

for (const file of sceneFiles(scenesDir)) {
	const scene = JSON.parse(readFileSync(file, "utf-8"));
	const problems = [];
	const notes = [];
	const { width: sceneW, height: sceneH } = scene;

	/* ---- background art matches the canvas ---- */
	const level = scene.levels?.[0];
	const bgSrc = level?.background?.src;
	if (!bgSrc) {
		problems.push("no background image on the scene's level");
	} else {
		const bg = resolveAsset(bgSrc);
		if (!bg.exists) problems.push(`background art missing: ${bgSrc}`);
		else if (bg.error) problems.push(`background art unreadable (${bg.error}): ${bgSrc}`);
		else if (!bg.external && (bg.width !== sceneW || bg.height !== sceneH)) {
			problems.push(
				`canvas is ${sceneW}x${sceneH} but the art is ${bg.width}x${bg.height} — ` +
					"the map is being rescaled and every placeable is offset",
			);
		}
	}

	/* ---- grid divides the canvas evenly ---- */
	const gridSize = scene.grid?.size;
	if (gridSize > 0 && scene.grid?.type !== 0) {
		const offX = sceneW % gridSize;
		const offY = sceneH % gridSize;
		if (offX || offY) {
			notes.push(
				`canvas ${sceneW}x${sceneH} is not a whole number of ${gridSize}px squares ` +
					`(${offX}px x ${offY}px left over)`,
			);
		}
	}

	/* ---- tiles cover what they claim to ---- */
	for (const tile of scene.tiles ?? []) {
		const src = tile.texture?.src;
		if (!src) {
			problems.push(`tile ${tile._id} has no texture`);
			continue;
		}
		const art = resolveAsset(src);
		if (!art.exists) {
			problems.push(`tile art missing: ${src}`);
			continue;
		}
		if (!art.external && !art.error && (art.width !== tile.width || art.height !== tile.height)) {
			notes.push(
				`tile ${tile._id} is ${tile.width}x${tile.height} but its art is ` +
					`${art.width}x${art.height}`,
			);
		}
		if (tile.x < 0 || tile.y < 0 || tile.x + tile.width > sceneW || tile.y + tile.height > sceneH) {
			notes.push(
				`tile ${tile._id} extends past the canvas ` +
					`(${tile.x},${tile.y} ${tile.width}x${tile.height} vs ${sceneW}x${sceneH})`,
			);
		}
	}

	/* ---- regions sit inside the canvas ---- */
	for (const region of scene.regions ?? []) {
		for (const [i, shape] of (region.shapes ?? []).entries()) {
			const b = shapeBounds(shape);
			if (!b) continue;
			if (b.minX < 0 || b.minY < 0 || b.maxX > sceneW || b.maxY > sceneH) {
				notes.push(
					`region "${region.name}" shape ${i} runs outside the canvas ` +
						`(${b.minX},${b.minY}-${b.maxX},${b.maxY} vs ${sceneW}x${sceneH})`,
				);
			}
		}
	}

	/* ---- placeables sit inside the canvas ---- */
	const outOfBounds = { walls: 0, lights: 0, tokens: 0, notes: 0, sounds: 0 };
	const inCanvas = (x, y) => x >= 0 && y >= 0 && x <= sceneW && y <= sceneH;

	for (const wall of scene.walls ?? []) {
		const [x1, y1, x2, y2] = wall.c ?? [];
		if (!inCanvas(x1, y1) || !inCanvas(x2, y2)) outOfBounds.walls += 1;
	}
	for (const light of scene.lights ?? []) {
		if (!inCanvas(light.x, light.y)) outOfBounds.lights += 1;
	}
	for (const token of scene.tokens ?? []) {
		if (!inCanvas(token.x, token.y)) outOfBounds.tokens += 1;
	}
	for (const note of scene.notes ?? []) {
		if (!inCanvas(note.x, note.y)) outOfBounds.notes += 1;
	}
	for (const sound of scene.sounds ?? []) {
		if (!inCanvas(sound.x, sound.y)) outOfBounds.sounds += 1;
	}
	for (const [kind, count] of Object.entries(outOfBounds)) {
		if (count) notes.push(`${count} ${kind} outside the canvas`);
	}

	/* ---- token art exists ---- */
	const missingArt = new Set();
	for (const token of scene.tokens ?? []) {
		const src = token.texture?.src;
		if (src && !resolveAsset(src).exists) missingArt.add(src);
	}
	for (const src of missingArt) problems.push(`token art missing: ${src}`);

	if (problems.length) errors += 1;
	if (notes.length) warnings += 1;

	const mark = problems.length ? "✗" : notes.length ? "⚠" : "✓";
	const summary =
		`${sceneW}x${sceneH}, grid ${gridSize}, ` +
		`${(scene.walls ?? []).length}w ${(scene.lights ?? []).length}l ` +
		`${(scene.tokens ?? []).length}t`;
	console.log(
		`${mark} ${relative(rootDir, file)} — ${scene.name} (${summary})` +
			[...problems, ...notes].map((p) => `\n    ${p}`).join(""),
	);
}

console.log(
	`\n${errors} scenes with geometry errors, ${warnings} with warnings.`,
);
process.exit(errors ? 1 : 0);
