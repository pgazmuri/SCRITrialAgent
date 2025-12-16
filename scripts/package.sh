#!/bin/bash
# Package the extension for distribution
# Creates a ZIP file that users can download and install locally

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Build the extension first
echo "Building extension..."
cd "$PROJECT_ROOT"
npm run build

# Create releases folder if it doesn't exist
mkdir -p "$PROJECT_ROOT/releases"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# Create ZIP filename with version
ZIP_NAME="scri-trial-agent-v$VERSION.zip"
ZIP_PATH="$PROJECT_ROOT/releases/$ZIP_NAME"

# Remove old ZIP if exists
rm -f "$ZIP_PATH"

# Create ZIP from dist folder
echo "Creating $ZIP_NAME..."
cd "$PROJECT_ROOT/dist"
zip -r "$ZIP_PATH" .

echo "✅ Created: $ZIP_PATH"
echo ""
echo "Users can download this ZIP and:"
echo "  1. Extract the ZIP to a folder"
echo "  2. Open chrome://extensions"
echo "  3. Enable Developer mode"
echo "  4. Click 'Load unpacked' and select the extracted folder"
