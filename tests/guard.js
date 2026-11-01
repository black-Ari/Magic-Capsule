'use strict';

const { execFileSync } = require('child_process');

// A running Nook or Poni owns Alt+N and the volume keys and sits where the test window sits, so it
// silently breaks these tests. A running Nook would also record the test clipboard and shelf items.
module.exports = function refuseIfNookIsRunning() {
  const script = `@(Get-Process | Where-Object { $_.ProcessName -in 'Nook', 'poni' -or ($_.ProcessName -eq 'electron' -and $_.Path -like '*build_workspaces\\poni*') }).Count`;
  const count = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim());
  if (count > 0) {
    console.error('Nook or Poni is running. Quit it from the tray icon, then run the tests again.');
    process.exit(2);
  }
};
