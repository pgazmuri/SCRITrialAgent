# Package the extension for distribution
# Creates a ZIP file that users can download and install locally

$ErrorActionPreference = "Stop"

# Get script directory and project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Build the extension first
Write-Host "Building extension..." -ForegroundColor Cyan
Push-Location $projectRoot
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location

# Create releases folder if it doesn't exist
$releasesDir = Join-Path $projectRoot "releases"
if (-not (Test-Path $releasesDir)) {
    New-Item -ItemType Directory -Path $releasesDir | Out-Null
}

# Get version from package.json
$packageJson = Get-Content (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $packageJson.version

# Create ZIP filename with version
$zipName = "scri-trial-agent-v$version.zip"
$zipPath = Join-Path $releasesDir $zipName

# Remove old ZIP if exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}

# Create ZIP from dist folder
Write-Host "Creating $zipName..." -ForegroundColor Cyan
$distPath = Join-Path $projectRoot "dist"
Compress-Archive -Path "$distPath\*" -DestinationPath $zipPath

Write-Host "✅ Created: $zipPath" -ForegroundColor Green
Write-Host ""
Write-Host "Users can download this ZIP and:" -ForegroundColor Yellow
Write-Host "  1. Extract the ZIP to a folder" -ForegroundColor Yellow
Write-Host "  2. Open chrome://extensions" -ForegroundColor Yellow
Write-Host "  3. Enable Developer mode" -ForegroundColor Yellow
Write-Host "  4. Click 'Load unpacked' and select the extracted folder" -ForegroundColor Yellow
