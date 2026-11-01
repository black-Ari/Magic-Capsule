'use strict';

// Compiles the always-running helper with the C# compiler that comes with Windows, so nothing extra has
// to be installed. If this program is missing, helper.ps1 does its work and only costs more memory.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LIB = path.join(__dirname, '..', 'lib');
const WINDOWS = process.env.windir || 'C:\\Windows';
const FRAMEWORK = path.join(WINDOWS, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const METADATA = path.join(WINDOWS, 'System32', 'WinMetadata');
const GAC = path.join(WINDOWS, 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Runtime');

function buildHelper() {
  const facade = path.join(GAC, fs.readdirSync(GAC)[0], 'System.Runtime.dll');
  const references = [
    path.join(FRAMEWORK, 'System.Web.Extensions.dll'),
    facade,
    path.join(METADATA, 'Windows.Foundation.winmd'),
    path.join(METADATA, 'Windows.Media.winmd'),
    path.join(METADATA, 'Windows.Storage.winmd'),
  ];
  execFileSync(path.join(FRAMEWORK, 'csc.exe'), [
    '/nologo', '/optimize+', '/target:winexe', '/platform:anycpu',
    `/out:${path.join(LIB, 'helper-service.exe')}`,
    ...references.map((file) => `/r:${file}`),
    path.join(LIB, 'helper-service.cs'),
    path.join(LIB, 'helper-native.cs'),
  ], { stdio: 'inherit' });
}

if (require.main === module) buildHelper();

module.exports = buildHelper;
