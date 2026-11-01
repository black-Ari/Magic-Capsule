'use strict';

// Builds the installer from a local copy, because the build is slow and fragile on Google Drive.
// electron-builder prepares the app folder, Inno Setup packs it, and the finished setup file is
// copied back to dist\ in this folder.
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const WORKSPACE = path.join(os.homedir(), '.build_workspaces', 'poni');
const STAGE = path.join(WORKSPACE, 'stage');
const OUTPUT = path.join(WORKSPACE, 'dist');
const ELECTRON = path.join(WORKSPACE, 'node_modules', 'electron');
const INCLUDED = ['main.js', 'preload.js', 'package.json', 'lib', 'renderer', 'assets'];
const KEEP_LOCALES = new Set(['en-US.pak', 'en-GB.pak', 'hi.pak']); // the rest only translate built-in menus Nook never shows
const INNO_FOLDERS = ['Inno Setup 7', 'Inno Setup 6'];
const INNO_ROOTS = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs')];

const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });

function findInno() {
  const candidates = INNO_FOLDERS.flatMap((folder) => INNO_ROOTS.filter(Boolean).map((root) => path.join(root, folder, 'ISCC.exe')));
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error('Inno Setup was not found. Install it from https://jrsoftware.org/isinfo.php');
  return found;
}

const inno = findInno();
fs.rmSync(STAGE, { recursive: true, force: true });
fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDED) fs.cpSync(path.join(PROJECT, item), path.join(STAGE, item), { recursive: true });

run('npm install --omit=dev --no-audit --no-fund', STAGE);
const { version } = JSON.parse(fs.readFileSync(path.join(ELECTRON, 'package.json'), 'utf8'));
run([
  `"${path.join(WORKSPACE, 'node_modules', '.bin', 'electron-builder.cmd')}"`,
  '--win --dir --publish never',
  `-c.electronVersion=${version}`,
  `-c.electronDist="${path.join(ELECTRON, 'dist')}"`,
  `-c.directories.output="${OUTPUT}"`,
].join(' '), STAGE);

const locales = path.join(OUTPUT, 'win-unpacked', 'locales');
for (const file of fs.readdirSync(locales)) if (!KEEP_LOCALES.has(file)) fs.rmSync(path.join(locales, file));

const { version: appVersion } = JSON.parse(fs.readFileSync(path.join(PROJECT, 'package.json'), 'utf8'));
execFileSync(inno, [
  '/Qp',
  `/DAppVersion=${appVersion}`,
  `/DSourceDir=${path.join(OUTPUT, 'win-unpacked')}`,
  `/DOutputDir=${OUTPUT}`,
  path.join(__dirname, 'installer.iss'),
], { stdio: 'inherit' });

const setup = fs.readdirSync(OUTPUT).find((name) => name.endsWith('.exe'));
fs.mkdirSync(path.join(PROJECT, 'dist'), { recursive: true });
fs.copyFileSync(path.join(OUTPUT, setup), path.join(PROJECT, 'dist', setup));
console.log(`Installer: ${path.join(PROJECT, 'dist', setup)}`);
