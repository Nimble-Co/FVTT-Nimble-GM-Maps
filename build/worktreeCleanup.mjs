import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const MODULE_NAME = 'nimble-maps';

/**
 * Get the FoundryVTT data path based on the operating system
 * @returns {string} Path to FoundryVTT Data directory
 */
function getFoundryDataPath() {
	const platform = os.platform();
	const homeDir = os.homedir();

	switch (platform) {
		case 'darwin':
			return path.join(homeDir, 'Library', 'Application Support', 'FoundryVTT', 'Data');
		case 'win32':
			return path.join(homeDir, 'AppData', 'Local', 'FoundryVTT', 'Data');
		case 'linux':
			return path.join(homeDir, '.local', 'share', 'FoundryVTT', 'Data');
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
}

/**
 * Check if a path is a symlink
 * @param {string} linkPath - Path to check
 * @returns {boolean}
 */
function isSymlink(linkPath) {
	try {
		return fs.lstatSync(linkPath).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Check if a path exists (file, directory, or symlink)
 * @param {string} targetPath - Path to check
 * @returns {boolean}
 */
function pathExists(targetPath) {
	try {
		fs.lstatSync(targetPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Ask the user a yes/no question
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>}
 */
async function confirm(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(`${question} [y/N] `, (answer) => {
			rl.close();
			resolve(/^y(es)?$/i.test(answer.trim()));
		});
	});
}

/**
 * Main cleanup function
 */
async function cleanup() {
	console.log('');
	console.log('╔════════════════════════════════════════╗');
	console.log('║   Nimble Maps Module Cleanup for FVTT  ║');
	console.log('╚════════════════════════════════════════╝');

	// Optional custom data path as first argument (same as worktree:setup)
	const customPath = process.argv[2];
	if (customPath && !fs.existsSync(customPath)) {
		console.error(`\nCustom FoundryVTT data path does not exist: ${customPath}`);
		process.exit(1);
	}

	const dataPath = customPath || getFoundryDataPath();
	const targetSymlinkPath = path.join(dataPath, 'modules', MODULE_NAME);
	const backupPath = `${targetSymlinkPath}.backup`;

	console.log(`\nModule path: ${targetSymlinkPath}`);

	// Step 1: Remove the symlink (never touch a real module directory)
	if (!pathExists(targetSymlinkPath)) {
		console.log('Nothing to clean up: no module symlink found.');
	} else if (isSymlink(targetSymlinkPath)) {
		const currentTarget = fs.readlinkSync(targetSymlinkPath);

		if (currentTarget !== rootDir) {
			console.log(`\nSymlink points to a different checkout:`);
			console.log(`  ${currentTarget}`);
			const proceed = await confirm('Remove it anyway?');
			if (!proceed) {
				console.log('Leaving symlink in place.');
				process.exit(0);
			}
		}

		fs.unlinkSync(targetSymlinkPath);
		console.log('Symlink removed.');
	} else {
		console.error(
			'\nThe module path is a real directory (not a symlink), likely a normal',
		);
		console.error('module install. Refusing to delete it — remove it via Foundry');
		console.error('or manually if that is really what you want.');
		process.exit(1);
	}

	// Step 2: Offer to restore a backup created by worktree:setup
	if (pathExists(backupPath)) {
		const restore = await confirm(
			`\nA backup exists at ${backupPath}. Restore it?`,
		);
		if (restore) {
			fs.renameSync(backupPath, targetSymlinkPath);
			console.log('Backup restored.');
		} else {
			console.log('Backup left in place.');
		}
	}

	console.log('');
	console.log('╔════════════════════════════════════════╗');
	console.log('║           Cleanup Complete!            ║');
	console.log('╚════════════════════════════════════════╝');
	console.log('');
}

cleanup();
