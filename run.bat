@echo off
setlocal
set "WORKSPACE=%USERPROFILE%\.build_workspaces\poni"
if not exist "%WORKSPACE%\node_modules\electron\dist\electron.exe" call "%~dp0setup.bat" || exit /b 1
start "" "%WORKSPACE%\node_modules\electron\dist\electron.exe" "%~dp0."
