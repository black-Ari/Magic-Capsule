'use strict';

// Node's own fetch adds about 38 MB to the main process the first time it runs. Chromium's network code
// is already running, so requests go through it. Without Electron, as in the unit tests, Node's is used.
const { net } = process.versions.electron ? require('electron') : {};

module.exports = (...args) => (net ? net.fetch(...args) : fetch(...args));
