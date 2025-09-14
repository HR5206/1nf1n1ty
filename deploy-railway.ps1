Param(
  [string]$ServiceName = "socialflow-pb",
  [string]$VolumeMount = "/data"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-NodeNpm {
  try { node -v | Out-Null; npm -v | Out-Null; return $true } catch { return $false }
}

function Ensure-RailwayCli {
  if (Get-Command railway -ErrorAction SilentlyContinue) { return 'railway' }
  if (-not (Ensure-NodeNpm)) {
    Write-Warning "Node.js/npm not found. Please install Node.js from https://nodejs.org and re-run this script, or use the Railway UI (recommended)."
    return $null
  }
  Write-Host "Installing Railway CLI globally..."
  npm i -g @railway/cli | Out-Null
  if (Get-Command railway -ErrorAction SilentlyContinue) { return 'railway' }
  return $null
}

$rail = Ensure-RailwayCli
if (-not $rail) {
  Write-Host "Falling back: Use Railway UI → New Project → Deploy from GitHub (this repo)." -ForegroundColor Yellow
  exit 0
}

& $rail login

# Initialize and link project
if (-not (Test-Path .\.railway)) { & $rail init }

# Create a volume if not present (UI strongly recommended for volumes)
Write-Host "Reminder: Add a Volume in Railway UI and mount it at $VolumeMount for persistence." -ForegroundColor Yellow

# Deploy
& $rail up
