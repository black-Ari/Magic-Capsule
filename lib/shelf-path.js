'use strict';

const fs = require('fs');
const path = require('path');

// "report.pdf" -> "report (2).pdf" when the name is taken.
function uniquePath(dir, name) {
  const { name: stem, ext } = path.parse(name);
  let candidate = path.join(dir, name);
  for (let n = 2; fs.existsSync(candidate); n += 1) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

module.exports = { uniquePath };
