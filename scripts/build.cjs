const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.chdir(path.join(__dirname, '..'));
require('esbuild').buildSync({ entryPoints: ['main.jsx'], bundle: true, minify: true,
  format: 'iife', target: 'es2019', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, outfile: 'app.js' });
const sw = fs.readFileSync('sw.js', 'utf8');
const shell = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png'];
const hash = crypto.createHash('sha256');
hash.update(sw.replace(/const CACHE = '[^']+';/, "const CACHE = '';"));
for (const file of shell.filter(file => file !== './')) hash.update(fs.readFileSync(file));
const version = hash.digest('hex').slice(0, 16);
fs.writeFileSync('sw.js', sw.replace(/const CACHE = '[^']+';/, `const CACHE = 'accretion-${version}';`));
console.log(`Built app.js and cache accretion-${version}`);
