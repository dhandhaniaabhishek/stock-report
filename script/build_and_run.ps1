param(
  [string]$Mode = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

function Resolve-ExpoCommand {
  if ($env:EXPO_CLI) {
    return $env:EXPO_CLI -split " "
  }

  $LocalExpo = Join-Path $RootDir "node_modules\.bin\expo.cmd"
  if (Test-Path $LocalExpo) {
    return @($LocalExpo)
  }

  if ((Test-Path "pnpm-lock.yaml") -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    return @("pnpm", "exec", "expo")
  }

  if ((Test-Path "yarn.lock") -and (Get-Command yarn -ErrorAction SilentlyContinue)) {
    return @("yarn", "expo")
  }

  if (((Test-Path "bun.lock") -or (Test-Path "bun.lockb")) -and (Get-Command bun -ErrorAction SilentlyContinue)) {
    return @("bunx", "expo")
  }

  return @("npx", "expo")
}

function Show-Usage {
  @"
usage: ./script/build_and_run.ps1 [mode]
usage: ./script/build_and_run.ps1 -Mode web

Modes:
  start, run
  --ios, ios
  --android, android
  --web, web
  --dev-client, dev-client
  --tunnel, tunnel
  --export-web, export-web
  --doctor, doctor
  --help, help
"@
}

$ExpoCommand = Resolve-ExpoCommand
$Program = $ExpoCommand[0]
$BaseArgs = @()
if ($ExpoCommand.Length -gt 1) {
  $BaseArgs = $ExpoCommand[1..($ExpoCommand.Length - 1)]
}

switch ($Mode) {
  { $_ -in @("start", "run") } { & $Program @BaseArgs "start"; break }
  { $_ -in @("--ios", "ios") } { & $Program @BaseArgs "start" "--ios"; break }
  { $_ -in @("--android", "android") } { & $Program @BaseArgs "start" "--android"; break }
  { $_ -in @("--web", "web") } { & $Program @BaseArgs "start" "--web"; break }
  { $_ -in @("--dev-client", "dev-client") } { & $Program @BaseArgs "start" "--dev-client"; break }
  { $_ -in @("--tunnel", "tunnel") } { & $Program @BaseArgs "start" "--tunnel"; break }
  { $_ -in @("--export-web", "export-web") } { & $Program @BaseArgs "export" "--platform" "web"; break }
  { $_ -in @("--doctor", "doctor") } { & "npx" "expo-doctor"; break }
  { $_ -in @("--help", "help") } { Show-Usage; break }
  default {
    Show-Usage
    exit 2
  }
}
