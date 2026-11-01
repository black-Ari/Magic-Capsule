@echo off
setlocal
if not exist "%USERPROFILE%\.build_workspaces\poni\node_modules\electron\dist\electron.exe" call "%~dp0setup.bat" || exit /b 1
node "%~dp0scripts\build.js"
