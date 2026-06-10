@echo off
cd /d "%~dp0.."
set EXPO_NO_TELEMETRY=1
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "node_modules\expo\bin\cli" start --web --port 8083 --host lan --clear > "expo-live-server.log" 2>&1
