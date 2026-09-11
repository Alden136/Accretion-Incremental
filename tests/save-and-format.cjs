// Run with: node tests/save-and-format.cjs
// Regressions for the display and save-validation bugs: a mantissa that
// rounded up to 10, and non-finite values surviving normalize().
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'Accretion.jsx'), 'utf8');
const cut = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
const context = { Math, Date, JSON, Number, String, Array, Object, isFinite };
vm.createContext(context);
vm.runInContext(
  cut('const BALANCE', '/* ---------- number formatting') +
  cut('/* ---------- number formatting', '/* ---------- audio') +
  cut('const newGame', '/* ---------- save handling') +
  cut('const SAVE_VER', '/* ---------- the object') +
  ';globalThis.api = { fmt, dur, normalize, genMax, shardMult, densCost, densLevelsFor, BALANCE };', context);
const { fmt, dur, normalize, genMax, shardMult, densCost, densLevelsFor, BALANCE } = context.api;

const SUPS = { '⁻': '-', '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };

// fmt must never print a mantissa of 10 or more: toFixed rounds 9.999 up to
// "10.00", which showed 10.00x10^20 in place of 1.00x10^21 on the mass counter.
for (let e = -300; e <= 300; e++) {
  for (const m of [1, 1.0000001, 9.99, 9.994, 9.995, 9.999999999, 9.9999999999999]) {
    const n = m * Math.pow(10, e);
    const out = fmt(n);
    const parts = out.match(/^(-?[\d.]+)×10(.+)$/);
    if (!parts) continue;
    assert.ok(Math.abs(parseFloat(parts[1])) < 10, `fmt(${n}) = "${out}"`);
    // and it still has to mean the same number
    const exp = Number([...parts[2]].map((c) => SUPS[c]).join(''));
    assert.ok(Math.abs(parseFloat(parts[1]) * Math.pow(10, exp) / n - 1) < 0.006, `fmt(${n}) = "${out}"`);
  }
}
assert.equal(fmt(9.999e20), '1.00×10²¹');
assert.equal(fmt(9.99e20), '9.99×10²⁰');
assert.equal(fmt(0), '0');
assert.equal(fmt(Infinity), '∞');

// JSON.parse turns an overflowing literal into Infinity, so a pasted save code
// can reach normalize with mass = Infinity. That made genMax return NaN, which
// slipped past buyGen's `n < 1` and `c > mass` guards and wrote NaN into state.
const hostile = [
  JSON.parse('{"mass":1e400,"gens":[1e400],"best":1e400,"played":1e400,"tap":1e400,"shards":1e400}'),
  { mass: NaN, best: NaN, gens: [NaN], played: NaN, tap: NaN },
  { mass: -5, best: -5, gens: [-3], tap: -2, shards: -9, shardsTotal: -9 },
  { mass: '1e30', gens: ['12'], tap: '4' },
  {},
];
for (const v of hostile) {
  const s = normalize(v);
  for (const [k, x] of Object.entries(s)) {
    if (typeof x !== 'number') continue;
    assert.ok(Number.isFinite(x), `normalize left ${k} = ${x} for ${JSON.stringify(v)}`);
    if (k !== 'lastSave') assert.ok(x >= 0, `normalize left ${k} negative`);
  }
  s.gens.forEach((g, i) => assert.ok(Number.isFinite(g) && g >= 0, `gens[${i}] = ${g}`));
  assert.ok(s.tap >= 0 && s.tap <= BALANCE.tapLevels, `tap out of range: ${s.tap}`);
  assert.ok(Number.isFinite(genMax(0, s.gens[0], s.mass)), 'genMax went non-finite');
  assert.ok(s.best >= s.mass, 'best must never sit below mass');
}

// Density is bought, not granted: nothing but s.dens may move the multiplier,
// and it has to compound rather than taper.
assert.equal(shardMult({ dens: 0 }), 1);
assert.equal(shardMult({}), 1, 'a save with no dens field gets no free bonus');
assert.equal(shardMult({ shardsTotal: 1e6 }), 1, 'shards earned must not grant output');
for (let n = 1; n <= 60; n++) {
  const step = shardMult({ dens: n }) / shardMult({ dens: n - 1 });
  assert.ok(Math.abs(step - BALANCE.densStep) < 1e-9, `level ${n} stepped by ${step}`);
  assert.ok(Number.isFinite(densCost({ dens: n })), `densCost(${n}) went non-finite`);
  assert.ok(densCost({ dens: n }) > densCost({ dens: n - 1 }), 'cost must strictly rise');
}
// the clamp in normalize keeps a corrupt save from reaching Infinity
assert.ok(Number.isFinite(shardMult(normalize({ mass: 1, gens: [], dens: 1e9 }))));
assert.ok(Number.isFinite(densCost(normalize({ mass: 1, gens: [], dens: 1e9 }))));

// v6 saves had a free saturating bonus; migration must not take output away
for (const total of [0, 1, 5, 27, 60, 200, 1000]) {
  const old = 3 - 2 / (1 + 0.06 * total);
  const s = normalize({ mass: 1, gens: [], shardsTotal: total, shards: 0 });
  assert.ok(shardMult(s) >= old - 1e-9,
    `a v6 save at ${total} shards had x${old.toFixed(2)}, migration gives x${shardMult(s).toFixed(2)}`);
  // and it must be idempotent: re-normalizing a migrated save changes nothing
  assert.equal(normalize(s).dens, s.dens, 'migration re-ran on an already-migrated save');
}

assert.equal(dur(0), '0m 0s');
assert.equal(dur(90), '1m 30s');
assert.equal(dur(3600), '1h 0m');
assert.equal(dur(31337), '8h 42m');

console.log('Save and format tests passed: mantissa carry, non-finite rejection, density track, v6 migration, durations.');
