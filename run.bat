@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "WORKSPACE=%USERPROFILE%\.build_workspaces\poni"
if not exist "%WORKSPACE%\node_modules\electron\dist\electron.exe" call "%~dp0setup.bat" || exit /b 1
if not exist "%~dp0lib\helper-service.exe" node "%~dp0scripts\build-helper.js"
start "" "%WORKSPACE%\node_modules\electron\dist\electron.exe" "%~dp0."
