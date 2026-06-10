@echo off
cd /d "%~dp0.."
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "script\serve_web_preview.js" > "web-preview-server.log" 2>&1
