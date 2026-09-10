// Run with: node tests/offline-time.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'Accretion.jsx'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(
  source.slice(source.indexOf('const BALANCE'), source.indexOf('/* ---------- number formatting')) +
  source.slice(source.indexOf('const newGame'), source.indexOf('/* ---------- save handling')) +
  ';globalThis.api = { newGame, applyOffline, prod };', context);
const { newGame, applyOffline, prod } = context.api;
const now = 1800000000000;
function state(seconds, deepTime = false) {
  const s = newGame();
  s.mass = 1; // Enough headroom to isolate the time limit from the mass limit.
  s.gens[0] = 1;
  s.perks[1] = deepTime;
  s.lastSave = now - seconds * 1000;
  return s;
}
for (const seconds of [0, 30, 60, 61, 3600, 28800, 28801, 86400]) {
  for (const perk of [false, true]) {
    const s = state(seconds, perk);
    const result = applyOffline(s, now);
    assert.equal(result.dt, seconds);
    assert.equal(result.credited, Math.min(seconds, 28800));
    assert.equal(result.gain, prod(s) * Math.min(seconds, 28800) * (perk ? 0.8 : 0.5));
    assert.equal(result.timeCapped, seconds > 28800);
    assert.equal(result.massCapped, false);
    assert.equal(s.lastSave, now);
    assert.equal(applyOffline(s, now).gain, 0, 'Same absence cannot be credited twice');
    const restored = JSON.parse(JSON.stringify(s));
    assert.equal(applyOffline(restored, now).gain, 0, 'Reload cannot replay an awarded absence');
  }
}
for (const timestamp of [undefined, null, NaN, Infinity, 0, now + 60000]) {
  const s = state(0); s.lastSave = timestamp;
  const result = applyOffline(s, now);
  assert.equal(result.dt, 0);
  assert.equal(result.gain, 0);
}
// The mass cap now scales with hours away rather than being one flat fraction
// of a stage, so at the 8-hour ceiling it sits ~1000x higher than it used to.
// A single level-1 accretor no longer out-earns it, so this fixture needs real
// production behind it to exercise the cap at all.
const capped = state(86400); capped.mass = 0; capped.gens[0] = 20;
const result = applyOffline(capped, now);
assert.equal(result.dt, 86400);
assert.equal(result.timeCapped, true);
assert.equal(result.massCapped, true);
const idle = state(3600); idle.gens[0] = 0;
assert.equal(applyOffline(idle, now).gain, 0);
console.log('Offline time tests passed: short absences, 8-hour boundary, 24 hours, both rates, replay protection, invalid clocks, and both caps.');
