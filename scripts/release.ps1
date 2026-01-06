# Build, increment version, and package for release
# Usage: .\scripts\release.ps1 [patch|minor|major]
# Default: patch (1.0.3 → 1.0.4)

param(
    [ValidateSet("patch", "minor", "major")]
    [string]$BumpType = "patch"
)

$ErrorActionPreference = "Stop"

# Get script directory and project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Read current version from manifest
$manifestPath = Join-Path $projectRoot "src\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$currentVersion = $manifest.version
Write-Host "Current version: $currentVersion" -ForegroundColor Cyan

# Parse and increment version
$parts = $currentVersion.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
$patch = [int]$parts[2]

switch ($BumpType) {
    "major" { $major++; $minor = 0; $patch = 0 }
    "minor" { $minor++; $patch = 0 }
    "patch" { $patch++ }
}

$newVersion = "$major.$minor.$patch"
Write-Host "New version: $newVersion" -ForegroundColor Green

# Update manifest.json - use regex to preserve formatting
$manifestContent = Get-Content $manifestPath -Raw
$manifestContent = $manifestContent -replace '"version":\s*"[^"]*"', "`"version`": `"$newVersion`""
[System.IO.File]::WriteAllText($manifestPath, $manifestContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "✅ Updated src/manifest.json" -ForegroundColor Green

# Also update package.json to keep in sync - use regex to preserve formatting
$packageJsonPath = Join-Path $projectRoot "package.json"
$packageContent = Get-Content $packageJsonPath -Raw
$packageContent = $packageContent -replace '"version":\s*"[^"]*"', "`"version`": `"$newVersion`""
[System.IO.File]::WriteAllText($packageJsonPath, $packageContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "✅ Updated package.json" -ForegroundColor Green

# Build the extension
Write-Host "`nBuilding extension..." -ForegroundColor Cyan
Push-Location $projectRoot
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Create releases folder if it doesn't exist
$releasesDir = Join-Path $projectRoot "releases"
if (-not (Test-Path $releasesDir)) {
    New-Item -ItemType Directory -Path $releasesDir | Out-Null
}

# Create ZIP filename with version
$zipName = "scri-trial-agent-v$newVersion.zip"
$zipPath = Join-Path $releasesDir $zipName

# Remove old ZIP if exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}

# Create ZIP from dist folder
Write-Host "Creating $zipName..." -ForegroundColor Cyan
$distPath = Join-Path $projectRoot "dist"
Compress-Archive -Path "$distPath\*" -DestinationPath $zipPath

Write-Host "`n✅ Release v$newVersion ready!" -ForegroundColor Green
Write-Host "   Package: $zipPath" -ForegroundColor Yellow
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "   1. git add -A && git commit -m 'Release v$newVersion'" -ForegroundColor White
Write-Host "   2. git push" -ForegroundColor White
Write-Host "   3. Refresh extension in Chrome (chrome://extensions)" -ForegroundColor White
