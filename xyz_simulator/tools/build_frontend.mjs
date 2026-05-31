// Rebuild app/static/js/robot_control.js from robot_control.src.jsx.
// Offline: uses the bundled tools/babel.standalone.js (no network needed).
// Run after editing the .src.jsx:  node tools/build_frontend.mjs
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app', 'static', 'js');

const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const Babel = require(join(here, 'babel.standalone.js'));

const src = readFileSync(join(appDir, 'robot_control.src.jsx'), 'utf8');
const out = Babel.transform(src, {
  presets: ['react', ['env', { targets: '> 0.25%, not dead' }]],
  comments: true,
}).code;
writeFileSync(join(appDir, 'robot_control.js'), out);
console.log('Built robot_control.js (' + out.length + ' bytes)');
