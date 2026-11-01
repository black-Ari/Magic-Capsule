@echo off
rem Dependencies live outside Google Drive so thousands of files are not synced.
setlocal
set "WORKSPACE=%USERPROFILE%\.build_workspaces\poni"
if not exist "%WORKSPACE%" mkdir "%WORKSPACE%"
copy /y "%~dp0package.json" "%WORKSPACE%\package.json" >nul
pushd "%WORKSPACE%"
call npm install --no-audit --no-fund || goto :failed
call node node_modules\electron\install.js || goto :failed
popd
node "%~dp0scripts\build-helper.js" || echo The small helper was not built, so PowerShell will do its work.
echo Setup finished. Start Magic Capsule with run.bat
exit /b 0

:failed
popd
echo Setup failed.
exit /b 1
