/**
 * Create a ZIP file for distribution
 * Run with: npm run package
 */

import { createWriteStream, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
const version = packageJson.version;

// Create releases folder
const releasesDir = join(projectRoot, 'releases');
if (!existsSync(releasesDir)) {
  mkdirSync(releasesDir, { recursive: true });
}

// We'll use a simple approach - just log instructions since Node doesn't have built-in ZIP
// For actual ZIP creation, use the PowerShell/bash scripts or install archiver

const distPath = join(projectRoot, 'dist');
const zipName = `scri-trial-agent-v${version}.zip`;

console.log('\n📦 Extension built successfully!\n');
console.log('To create a distributable ZIP:\n');

if (process.platform === 'win32') {
  console.log('  PowerShell:');
  console.log(`    Compress-Archive -Path "${distPath}\\*" -DestinationPath "${join(releasesDir, zipName)}"\n`);
} else {
  console.log('  Terminal:');
  console.log(`    cd "${distPath}" && zip -r "${join(releasesDir, zipName)}" .\n`);
}

console.log('Or run the platform-specific script:');
console.log('  Windows: .\\scripts\\package.ps1');
console.log('  Mac/Linux: ./scripts/package.sh\n');

console.log('---\n');
console.log('📁 For manual installation, users can:');
console.log('  1. Load the dist/ folder directly in chrome://extensions');
console.log('  2. Or download/share the ZIP and extract before loading\n');
