import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const MODULE_NAME = 'nimble-maps';

/**
 * Run a command and stream output to console
 * @param {string} command - Command to run
 * @param {string} description - Description of the step
 */
function runCommand(command, description) {
	console.log(`\n${'─'.repeat(40)}`);
	console.log(`${description}...`);
	console.log(`$ ${command}`);
	console.log('─'.repeat(40));

	try {
		execSync(command, { cwd: rootDir, stdio: 'inherit' });
	} catch (err) {
		console.error(`\nFailed: ${description}`);
		process.exit(1);
	}
}

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
 * Prompt user with a menu of options
 * @param {string} title - Title for the prompt box
 * @param {string[]} infoLines - Additional info lines to display
 * @param {Array<{key: string, label: string, destructive?: boolean}>} options - Menu options
 * @returns {Promise<string>} - The selected option key
 */
async function promptUser(title, infoLines, options) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const maxWidth = Math.max(
		title.length,
		...infoLines.map((l) => l.length),
		...options.map((o) => `  ${o.key}. ${o.label}`.length),
	);
	const boxWidth = maxWidth + 4;

	console.log('');
	console.log(`╔${'═'.repeat(boxWidth)}╗`);
	console.log(`║  ${title.padEnd(boxWidth - 2)}║`);
	for (const line of infoLines) {
		console.log(`║  ${line.padEnd(boxWidth - 2)}║`);
	}
	console.log(`╚${'═'.repeat(boxWidth)}╝`);
	console.log('');
	console.log('What would you like to do?');
	console.log('');

	for (const option of options) {
		const label = option.destructive ? `${option.label} (DESTRUCTIVE)` : option.label;
		console.log(`  ${option.key}. ${label}`);
	}

	console.log('');

	return new Promise((resolve) => {
		const validKeys = options.map((o) => o.key);

		const askQuestion = () => {
			rl.question('> ', (answer) => {
				const trimmed = answer.trim();
				if (validKeys.includes(trimmed)) {
					rl.close();
					resolve(trimmed);
				} else {
					console.log(`Please enter one of: ${validKeys.join(', ')}`);
					askQuestion();
				}
			});
		};

		askQuestion();
	});
}

/**
 * Setup the symlink to FoundryVTT
 * @returns {Promise<void>}
 */
async function setupSymlink(customPath) {
	const foundryDataPath = customPath || getFoundryDataPath();
	const modulesPath = path.join(foundryDataPath, 'modules');
	const targetSymlinkPath = path.join(modulesPath, MODULE_NAME);

	console.log(`\n${'─'.repeat(40)}`);
	console.log('Setting up FoundryVTT symlink...');
	console.log('─'.repeat(40));
	console.log(`Source (module):  ${rootDir}`);
	console.log(`Target (symlink): ${targetSymlinkPath}`);

	// Check if FoundryVTT data directory exists
	if (!fs.existsSync(foundryDataPath)) {
		console.error(`\nFoundryVTT data directory not found at: ${foundryDataPath}`);
		console.error('Make sure FoundryVTT is installed and has been run at least once.');
		process.exit(1);
	}

	// Ensure modules directory exists
	if (!fs.existsSync(modulesPath)) {
		console.log(`Creating modules directory: ${modulesPath}`);
		fs.mkdirSync(modulesPath, { recursive: true });
	}

	// Handle existing path at target location
	if (pathExists(targetSymlinkPath)) {
		if (isSymlink(targetSymlinkPath)) {
			const currentTarget = fs.readlinkSync(targetSymlinkPath);
			if (currentTarget === rootDir) {
				console.log('Symlink already exists and points to this module folder.');
				return;
			}

			// Symlink exists but points elsewhere - ask user what to do
			const choice = await promptUser(
				'Existing symlink detected',
				[`Location: ${targetSymlinkPath}`, `Currently points to: ${currentTarget}`],
				[
					{ key: '1', label: 'Replace symlink (point to this module)' },
					{ key: '2', label: 'Skip (keep existing symlink)' },
					{ key: '3', label: 'Cancel setup' },
				],
			);

			switch (choice) {
				case '1':
					console.log('Removing existing symlink...');
					fs.unlinkSync(targetSymlinkPath);
					break;
				case '2':
					console.log('Skipping symlink setup.');
					return;
				case '3':
					console.log('Setup cancelled.');
					process.exit(0);
			}
		} else {
			// Real file or directory exists - ask user what to do
			const stats = fs.lstatSync(targetSymlinkPath);
			const typeLabel = stats.isDirectory() ? 'directory' : 'file';
			const backupPath = `${targetSymlinkPath}.backup`;

			const choice = await promptUser(
				`Existing ${typeLabel} detected`,
				[`Location: ${targetSymlinkPath}`],
				[
					{ key: '1', label: `Delete ${typeLabel} and create symlink`, destructive: true },
					{ key: '2', label: `Backup to ${MODULE_NAME}.backup and create symlink` },
					{ key: '3', label: 'Skip (keep existing)' },
					{ key: '4', label: 'Cancel setup' },
				],
			);

			switch (choice) {
				case '1':
					console.log(`Deleting existing ${typeLabel}...`);
					fs.rmSync(targetSymlinkPath, { recursive: true, force: true });
					break;
				case '2':
					if (pathExists(backupPath)) {
						console.log(`Removing old backup at ${backupPath}...`);
						fs.rmSync(backupPath, { recursive: true, force: true });
					}
					console.log(`Backing up to ${backupPath}...`);
					fs.renameSync(targetSymlinkPath, backupPath);
					break;
				case '3':
					console.log('Skipping symlink setup.');
					return;
				case '4':
					console.log('Setup cancelled.');
					process.exit(0);
			}
		}
	}

	// Create the symlink
	try {
		fs.symlinkSync(rootDir, targetSymlinkPath, 'dir');
		console.log('Symlink created successfully!');
	} catch (err) {
		console.error('Failed to create symlink:', err.message);
		process.exit(1);
	}
}

/**
 * Main setup function
 */
async function setup() {
	console.log('');
	console.log('╔════════════════════════════════════════╗');
	console.log('║   Nimble Maps Module Setup for FVTT    ║');
	console.log('╚════════════════════════════════════════╝');

	// Step 1: Get potential custom path from argument
	const customPath = process.argv[2];
	if (customPath) {
		// Verify the custom path exists
		if (!fs.existsSync(customPath)) {
			console.error(`\nCustom FoundryVTT data path does not exist: ${customPath}`);
			process.exit(1);
		}
		console.log(`\nUsing custom FoundryVTT data path from argument: ${customPath}`);
	}

	// Step 2: Install dependencies
	runCommand('npm install', 'Installing dependencies');

	// Step 3: Build the compendium
	runCommand('npm run build', 'Building scene compendium');

	// Step 4: Setup symlink
	await setupSymlink(customPath);

	console.log('');
	console.log('╔════════════════════════════════════════╗');
	console.log('║            Setup Complete!             ║');
	console.log('╚════════════════════════════════════════╝');
	console.log('');
	console.log('You can now start FoundryVTT and enable the Nimble Maps module.');
	console.log('The scenes will be available in the "Nimble GM Guide Scenes" compendium.');
	console.log('');
}

setup();
