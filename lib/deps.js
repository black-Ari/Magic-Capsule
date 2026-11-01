'use strict';

// A packaged app bundles its dependencies. While developing they live outside Google Drive
// (see setup.bat), and Electron ignores NODE_PATH, so that folder is looked up explicitly.
const os = require('os');
const path = require('path');

const WORKSPACE = path.join(os.homedir(), '.build_workspaces', 'poni');

module.exports = function dep(name) {
  try {
    return require(name);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return require(require.resolve(name, { paths: [WORKSPACE] })); // respects each package's own entry points
  }
};
