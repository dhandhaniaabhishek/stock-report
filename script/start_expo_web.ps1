param(
  [int]$Port = 8083
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$ExpoCli = Join-Path $RootDir "node_modules\expo\bin\cli"

Set-Location $RootDir

if (-not (Test-Path $BundledNode)) {
  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $NodeCommand) {
    throw "Node.js was not found. Install Node.js or run from Codex with the bundled runtime."
  }
  $BundledNode = $NodeCommand.Source
}

& $BundledNode $ExpoCli start --web --port $Port --host lan --clear
