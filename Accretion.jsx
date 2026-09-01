import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/* ============================================================
   ACCRETION — an incremental game about mass

   Economy notes (simulated before shipping):
   - Every accretor pays for itself in 20s at level 1.
   - Cost grows 1.15x per level; production milestones give x3.4
     every 10 levels. Cost wins slightly (payback +1.75%/level),
     so no accretor can run away on its own.
   - Unlocking the next accretor is worth ~4x the value of your
     current one. That burst is the whole progression rhythm.
   - Stage bonuses are ONE-TIME mass grants, never permanent
     production multipliers. Permanent multipliers that scale
     with progress are what break an economy like this.
   - Global upgrades are a bounded set of seven, x17 in total.
   - Accretors sit every ~2.3 stages instead of every ~5 decades.
     The old spacing let one accretor (Fusion Core) span eight
     stages, so the whole planet-to-star run had no pacing control.
   - Each accretor carries its own yield, solved numerically against
     the local density of the mass ladder. Stages sit ~4 decades
     apart early and ~1 decade apart from planet to star, so a flat
     yield makes the late ladder blur past.
   - Act two (galaxy onward) exists because one black hole cannot
     grow past ~5e10 solar masses; above that its disk fragments
     into stars. So the ladder becomes bound structure instead.
   - Shard perks are bounded and none of them compound with mass.
   - Pacing target is a geometric ramp, ~35s for the first stage to
     ~330s for the last, and late accretors carry weaker milestones
     so the final stretch turns sub-exponential.
   - Stage bonus and offline windfall are fractions of the gap to
     the NEXT stage, never fixed multipliers: a fixed x1.4 was 4% of
     an early gap and 47% of the Sun-to-neutron-star gap.
   Result: ~52s/stage in the rock era, ~113s planets-to-stars,
   ~200s black holes, ~250s galaxies-to-universe; ~90 min first run.
   ============================================================ */

const BALANCE = {
  costGrowth: 1.15,
  milestoneEvery: 10,
  stageShare: 0.12,   // stage bonus = this fraction of the way to the NEXT stage
  offlineShare: 0.40, // offline earnings can never carry you past this fraction
  tapShare: 0.1,      // fraction of a second's output per tap
  offlineRate: 0.5,
  offlineCapH: 8,
  shardRate: 2,
  shardPower: 0.07,
  shardValue: 0.15,   // +15% production per shard ever earned
};

const ATOM = 1.67e-27;
const SUN = 1.989e30;
const EARTH = 5.972e24;
const SAVE_KEY = 'accretion_save_v6';

/* --- the ladder: every threshold is a real mass in kg --- */
const TIERS = [
  { n: 'Hydrogen atom',      at: ATOM,    k: 'atom',    c: ['#dbeafe', '#3b82f6'], d: 'One proton, one electron, and three quarters of all ordinary matter.' },
  { n: 'Molecular cluster',  at: 1e-24,   k: 'atom',    c: ['#e0e7ff', '#6366f1'], d: 'A few hundred atoms bonded at ten kelvin.' },
  { n: 'Soot particle',      at: 1e-20,   k: 'rock',    c: ['#57534e', '#1c1917'], d: 'Aromatic carbon, ten nanometres across. The galaxy is full of it.' },
  { n: 'Dust grain',         at: 1e-17,   k: 'rock',    c: ['#d6d3d1', '#78716c'], d: 'Silicate, a tenth of a micron. This is what reddens starlight.' },
  { n: 'Dust aggregate',     at: 1e-13,   k: 'rock',    c: ['#e7e5e4', '#a8a29e'], d: 'Fluffy, loosely bound, held together by nothing but contact.' },
  { n: 'Mote',               at: 1e-9,    k: 'rock',    c: ['#d6d3d1', '#57534e'], d: 'Big enough to see in a sunbeam. Barely.' },
  { n: 'Grit',               at: 1e-5,    k: 'rock',    c: ['#a8a29e', '#44403c'], d: 'A millimetre. Collisions start building instead of shattering.' },
  { n: 'Pebble',             at: 1e-1,    k: 'rock',    c: ['#a8a29e', '#292524'], d: 'Pebble accretion: the fast lane from dust to planet.' },
  { n: 'Boulder',            at: 1e4,     k: 'rock',    c: ['#94a3b8', '#334155'], d: 'Ten tonnes, tumbling through the disk.' },
  { n: 'Meteoroid',          at: 1e6,     k: 'rock',    c: ['#a8a29e', '#292524'], d: 'Nine metres of rock. Big enough now to survive an atmosphere.' },
  { n: 'Monolith',           at: 1e8,     k: 'rock',    c: ['#a1a1aa', '#3f3f46'], d: 'Forty metres of loose rubble that keeps finding more rubble.' },
  { n: 'Rubble pile',        at: 7.3e10,  k: 'rock',    c: ['#b8b0a8', '#3f3a36'], d: 'Bennu-class: a heap of gravel you could jump off of.' },
  { n: 'Mountain',           at: 1e12,    k: 'rock',    c: ['#94a3b8', '#1e293b'], d: 'A kilometre wide. Gravity is finally doing the work for you.' },
  { n: 'Comet nucleus',      at: 2.2e14,  k: 'rock',    c: ['#cbd5e1', '#1e293b'], d: "Halley's nucleus: ice and dust, and a tail when it gets close." },
  { n: 'Planetesimal',       at: 1e17,    k: 'rock',    c: ['#a8a29e', '#3f3f46'], d: 'Fifty kilometres. The seed of a world.' },
  { n: 'Metal asteroid',     at: 2.29e19, k: 'rock',    c: ['#cbd5e1', '#475569'], d: '16 Psyche: iron and nickel, possibly a stripped planetary core.' },
  { n: 'Asteroid',           at: 2.59e20, k: 'rock',    c: ['#b45309', '#451a03'], d: 'Vesta-class: melted, layered, and 4.5 billion years old.' },
  { n: 'Dwarf planet',       at: 1.31e22, k: 'planet',  c: ['#fbbf24', '#78350f'], d: 'Pluto-class. Round under its own gravity at last.' },
  { n: 'Terrestrial planet', at: EARTH,   k: 'planet',  c: ['#38bdf8', '#047857'], d: 'One Earth mass. Enough pull to keep an atmosphere.' },
  { n: 'Ice giant',          at: 1.02e26, k: 'planet',  c: ['#67e8f9', '#0e7490'], d: 'Neptune-class. Supersonic winds over a mantle of hot ice.' },
  { n: 'Gas giant',          at: 1.90e27, k: 'gas',     c: ['#fcd34d', '#b45309'], d: 'Jupiter-class. Hydrogen turns metallic in the core.' },
  { n: 'Brown dwarf',        at: 2.5e28,  k: 'gas',     c: ['#fb923c', '#7c2d12'], d: 'Thirteen Jupiters. Fuses deuterium, and little else.' },
  { n: 'Red dwarf',          at: 1.6e29,  k: 'star',    c: ['#f87171', '#7f1d1d'], d: 'Fully convective and frugal. Good for a trillion years.' },
  { n: 'Sun-like star',      at: SUN,     k: 'star',    c: ['#fde68a', '#f59e0b'], d: 'One solar mass, burning hydrogen on the main sequence.' },
  { n: 'Neutron star',       at: 4.1e30,  k: 'neutron', c: ['#e0f2fe', '#38bdf8'], d: 'PSR J0740+6620: two solar masses packed into twenty kilometres.' },
  { n: 'Blue supergiant',    at: 4e31,    k: 'star',    c: ['#bfdbfe', '#2563eb'], d: 'Twenty solar masses, spent in ten million years.' },
  { n: 'Stellar black hole', at: 2e32,    k: 'hole',    c: ['#a78bfa', '#1e1b4b'], d: 'The core lost its argument with gravity.' },
  { n: 'Intermediate hole',  at: 2e33,    k: 'hole',    c: ['#c084fc', '#2e1065'], d: 'A thousand suns. Rare, and mostly still hypothetical.' },
  { n: 'Seed hole',          at: 1e35,    k: 'hole',    c: ['#d8b4fe', '#3b0764'], d: 'Half a million suns, waiting for a galaxy to form around it.' },
  { n: 'Supermassive hole',  at: 8.5e36,  k: 'hole',    c: ['#f0abfc', '#4a044e'], d: 'Sagittarius A*, anchoring everything you can see.' },
  { n: 'Quasar engine',      at: 1e39,    k: 'hole',    c: ['#f5d0fe', '#701a75'], d: 'Feeding hard enough to outshine its host galaxy.' },
  { n: 'Ultramassive hole',  at: 1.3e41,  k: 'hole',    c: ['#fbcfe8', '#f472b6'], d: 'TON 618. Sixty-six billion suns — near the ceiling for any one hole.' },

  /* Act two. A single black hole cannot grow much past TON 618: above
     roughly 5e10 solar masses the accretion disk fragments into stars
     instead of feeding the hole. So the ladder stops being one object
     and becomes bound structure. Masses include dark matter halos. */
  { n: 'Spiral galaxy',      at: 3e42,    k: 'galaxy',  c: ['#bfdbfe', '#1e3a8a'], d: 'Milky Way-class. A hundred billion stars around your hole.' },
  { n: 'Giant elliptical',   at: 2e44,    k: 'blob',    c: ['#fde68a', '#78350f'], d: 'IC 1101: a hundred trillion suns, and no arms left to speak of.' },
  { n: 'Galaxy cluster',     at: 2.4e45,  k: 'cluster', c: ['#a5b4fc', '#312e81'], d: 'Virgo-class. A thousand galaxies falling toward one centre.' },
  { n: 'Supercluster',       at: 2e47,    k: 'cluster', c: ['#c4b5fd', '#4c1d95'], d: 'Laniakea. Everything here is already flowing inward.' },
  { n: 'Cosmic filament',    at: 4e48,    k: 'web',     c: ['#93c5fd', '#1e40af'], d: 'The Sloan Great Wall: a billion light years of strung-together clusters.' },
  { n: 'Local volume',       at: 1e50,    k: 'web',     c: ['#a5f3fc', '#155e75'], d: 'Every galaxy within two billion light years, at mean cosmic density.' },
  { n: 'All stellar matter', at: 2.4e51,  k: 'cosmos',  c: ['#fef3c7', '#b45309'], d: 'Every star that has ever shone inside the observable universe.' },
  { n: 'All ordinary matter', at: 2.4e52, k: 'cosmos',  c: ['#e9d5ff', '#6b21a8'], d: 'Every atom there is — and still only 5% of what exists.' },
  { n: 'The observable universe', at: 1.5e53, k: 'cosmos', c: ['#ffffff', '#a78bfa'], d: 'Matter, dark matter, all of it, out to the edge of what light can reach.' },
];

const PRESTIGE_AT = 29;

/* Accretors are spaced to sit every ~2.3 stages rather than every ~5
   decades, so no single unlock spans a whole run of stages. Each one
   carries its own yield, solved against the local density of the mass
   ladder: where stages sit ~1 decade apart (planet through star) the
   yield is low so those stages don't blur past. */
const GENS = [
  { n: 'Quantum foam sifter',   d: 'Skims virtual pairs out of empty space',   cost: 1e-26, y: 0.153, m: 3.4, c: '#93c5fd' },
  { n: 'Molecular binder',      d: 'Chemistry, run at a profit',               cost: 1e-19, y: 0.083, m: 3.4, c: '#a5b4fc' },
  { n: 'Dust accreter',         d: 'Sweeps grains from a cold nebula',         cost: 1e-11, y: 0.11, m: 3.4, c: '#cbd5e1' },
  { n: 'Electrostatic clumper', d: 'Static charge welds dust into gravel',     cost: 1e-2,  y: 0.05, m: 3.4, c: '#d6d3d1' },
  { n: 'Gravity well',          d: 'Mass finally starts attracting mass',      cost: 1e6,   y: 0.043, m: 3.4, c: '#fbbf24' },
  { n: 'Runaway accreter',      d: 'The biggest body eats fastest',            cost: 1e11,  y: 0.025, m: 3.4, c: '#f59e0b' },
  { n: 'Orbital dredge',        d: 'Clears the neighbourhood, permanently',    cost: 1e16,  y: 0.0085, m: 3.4, c: '#f97316' },
  { n: 'Planetary sweeper',     d: 'Bends whole orbits into your path',        cost: 1e20,  y: 0.0028, m: 3.4, c: '#38bdf8' },
  { n: 'Atmosphere harvester',  d: 'Strips hydrogen and helium from the disk', cost: 1e25,  y: 0.001, m: 3.4, c: '#67e8f9' },
  { n: 'Stellar nursery',       d: 'Collapses a molecular cloud on demand',    cost: 1e28,  y: 0.0025, m: 3.4, c: '#fb923c' },
  { n: 'Fusion core',           d: 'Burns hydrogen and hoards the ash',        cost: 1e30,  y: 0.00098, m: 3.25, c: '#fde68a' },
  { n: 'Degenerate press',      d: 'Packs matter past what electrons allow',   cost: 1e32,  y: 0.0019, m: 3.15, c: '#e0f2fe' },
  { n: 'Accretion disk',        d: 'Infall at a tenth of light speed',         cost: 1e34,  y: 0.0049, m: 3.05, c: '#c084fc' },
  { n: 'Horizon trawler',       d: 'Swallows star systems whole',              cost: 1e38,  y: 0.011, m: 2.95, c: '#f0abfc' },
  { n: 'Merger cascade',        d: 'Two holes become one, over and over',      cost: 1e41,  y: 0.0036, m: 2.9, c: '#f472b6' },
  { n: 'Halo assembler',        d: 'Binds dark matter into a halo around you', cost: 1e44,  y: 0.0012, m: 2.85, c: '#818cf8' },
  { n: 'Cluster infall',        d: 'Whole galaxies arrive on radial orbits',   cost: 1e47,  y: 0.003, m: 2.8, c: '#c4b5fd' },
  { n: 'Filament siphon',       d: 'Draws matter down the cosmic web',         cost: 5e49,  y: 0.001, m: 2.75, c: '#5eead4' },
  { n: 'Horizon harvest',       d: 'Gathers everything light can still reach', cost: 1e52,  y: 0.0004, m: 2.7, c: '#ffffff' },
];
GENS.forEach((g) => { g.prod = g.cost * g.y; });

/* bounded global upgrades — ten, x58 in total */
const UPGRADES = [
  { n: 'Van der Waals coupling', d: 'Grains stop bouncing off each other',        cost: 1e-20, mult: 1.5, c: '#a7f3d0' },
  { n: 'Electrostatic charging', d: 'Dust holds a charge and clings',             cost: 1e-13, mult: 1.5, c: '#6ee7b7' },
  { n: 'Gravitational focusing', d: 'Your pull widens your own capture area',     cost: 1e-4,  mult: 1.5, c: '#34d399' },
  { n: 'Runaway growth',         d: 'The gap between you and the rest widens',    cost: 1e8,   mult: 1.5, c: '#5eead4' },
  { n: 'Hill sphere expansion',  d: 'You dominate a larger volume of the disk',   cost: 1e18,  mult: 1.5, c: '#22d3ee' },
  { n: 'Gravitational braking',  d: 'Infalling matter sheds angular momentum',    cost: 1e27,  mult: 1.5, c: '#38bdf8' },
  { n: 'Relativistic infall',    d: 'Matter arrives at a fraction of light speed', cost: 1e34, mult: 1.5, c: '#818cf8' },
  { n: 'Dynamical friction',     d: 'Passing galaxies lose energy and sink in',   cost: 1e41,  mult: 1.5, c: '#a78bfa' },
  { n: 'Dark matter coupling',   d: 'The invisible 85% starts working for you',   cost: 1e46,  mult: 1.5, c: '#c084fc' },
  { n: 'Comoving capture',       d: 'You outpace the expansion of space itself',  cost: 1e51,  mult: 1.5, c: '#e879f9' },
];

/* spent with collapse shards; bounded, and none of them compound */
const SHARD_C = '#f0abfc';
const PERKS = [
  { n: 'Residual disk',       d: 'Begin every run with 20 levels of your first two accretors', cost: 4 },
  { n: 'Deep time',           d: 'Offline accretion runs at 80% instead of 50%, up to the cap', cost: 8 },
  { n: 'Tidal capture',       d: 'Pulls draw a quarter-second of output instead of a tenth',   cost: 14 },
  { n: 'Fossil metallicity',  d: 'Stage bonuses nearly double: 22% of the next gap, not 12%',   cost: 24 },
];

/* ---------- number formatting ---------- */
const SUPS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (s) => String(s).split('').map((c) => SUPS[c] || c).join('');

function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(n)));
  if (e >= -2 && e < 4) return n.toFixed(Math.max(0, Math.min(4, 2 - e)));
  return `${(n / Math.pow(10, e)).toFixed(2)}×10${sup(e)}`;
}

function altMass(kg) {
  if (kg >= 1e29) return `${fmt(kg / SUN)} solar masses`;
  if (kg >= 1e22) return `${fmt(kg / EARTH)} Earth masses`;
  if (kg >= 1e3) return `${fmt(kg / 1000)} tonnes`;
  if (kg >= 1e-24) return `${fmt(kg / ATOM)} hydrogen atoms`;
  return 'lighter than one atom';
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- audio: everything is synthesised, no asset files ----------
   Sounds deepen as you gain mass, so an atom pings and a black hole
   thuds. The context is created lazily on the first touch because
   mobile browsers refuse to start audio without a user gesture.      */
const SFX = (() => {
  let ctx = null, master = null, noiseBuf = null, drone = null;
  let on = true, lastPull = -1;

  const VOLUME = 1.8;   // overall loudness; the limiter below catches the peaks

  const ensure = () => {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // master -> limiter -> speakers. Without the limiter, a tap landing
      // on top of a stage chord would sum past 1.0 and crackle.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      limiter.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(limiter);
    } catch (e) { ctx = null; }
    return ctx;
  };

  const tone = (freq, o = {}) => {
    const c = ensure(); if (!c || !on) return;
    const { type = 'sine', dur = 0.15, gain = 0.2, glide = null, delay = 0, attack = 0.005 } = o;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(freq, 20), t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(glide, 20), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  };

  const noise = (o = {}) => {
    const c = ensure(); if (!c || !on) return;
    const { dur = 0.12, gain = 0.12, freq = 800, q = 1, type = 'bandpass', delay = 0, sweep = null } = o;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(freq, 40), t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(sweep, 40), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.03);
  };

  const droneFreq = (stage) => 116 * Math.pow(0.972, stage);

  const startDrone = (stage) => {
    const c = ensure(); if (!c || drone) return;
    const g = c.createGain(); g.gain.value = 0.0001; g.connect(master);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 460; f.Q.value = 0.7;
    f.connect(g);
    const base = droneFreq(stage);
    const oscs = [[1, 'triangle', -7], [1.5, 'sine', 5], [0.5, 'sine', 0]].map(([mul, type, det]) => {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = base * mul; o.detune.value = det;
      o.connect(f); o.start(); return o;
    });
    g.gain.exponentialRampToValueAtTime(0.022, c.currentTime + 2);
    drone = { g, oscs, mults: [1, 1.5, 0.5] };
  };

  const stopDrone = () => {
    if (!drone || !ctx) return;
    const d = drone; drone = null;
    d.g.gain.cancelScheduledValues(ctx.currentTime);
    d.g.gain.setValueAtTime(Math.max(d.g.gain.value, 0.0001), ctx.currentTime);
    d.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    setTimeout(() => { try { d.oscs.forEach((o) => o.stop()); } catch (e) { /* already stopped */ } }, 900);
  };

  return {
    unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    setOn(v) { on = v; if (!v) stopDrone(); },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },

    hum(enabled, stage) {
      if (!on || !enabled) { stopDrone(); return; }
      startDrone(stage);
    },
    humStage(stage) {
      if (!drone || !ctx) return;
      const base = droneFreq(stage);
      drone.oscs.forEach((o, i) => {
        o.frequency.cancelScheduledValues(ctx.currentTime);
        o.frequency.setValueAtTime(o.frequency.value, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(base * drone.mults[i], ctx.currentTime + 2.5);
      });
    },

    pull(kind, stage) {
      const c = ensure(); if (!c || !on) return;
      if (c.currentTime - lastPull < 0.035) return;   // rate limit rapid tapping
      lastPull = c.currentTime;
      const d = Math.pow(0.988, stage), j = 0.97 + Math.random() * 0.06;
      if (kind === 'atom') {
        tone(880 * d * j, { type: 'triangle', dur: 0.09, gain: 0.15 });
        tone(1760 * d * j, { type: 'sine', dur: 0.05, gain: 0.045 });
      } else if (kind === 'rock') {
        noise({ dur: 0.07, gain: 0.1, freq: 540 * d * j, q: 1.4 });
        tone(124 * d * j, { type: 'sine', dur: 0.1, gain: 0.14, glide: 82 * d });
      } else if (kind === 'planet' || kind === 'gas') {
        tone(196 * d * j, { type: 'sine', dur: 0.18, gain: 0.16, glide: 152 * d });
        noise({ dur: 0.13, gain: 0.035, freq: 900, type: 'lowpass' });
      } else if (kind === 'star') {
        tone(262 * d * j, { type: 'sine', dur: 0.2, gain: 0.13 });
        tone(392 * d * j, { type: 'sine', dur: 0.2, gain: 0.06, delay: 0.02 });
      } else if (kind === 'neutron') {
        tone(1320 * j, { type: 'sine', dur: 0.07, gain: 0.1, glide: 660 });
        noise({ dur: 0.04, gain: 0.045, freq: 3200, q: 2 });
      } else {
        tone(72 * j, { type: 'sine', dur: 0.28, gain: 0.22, glide: 44 });
        noise({ dur: 0.22, gain: 0.045, freq: 300, type: 'lowpass', sweep: 80 });
      }
    },

    buy() {
      tone(523, { type: 'triangle', dur: 0.06, gain: 0.08 });
      tone(784, { type: 'triangle', dur: 0.08, gain: 0.07, delay: 0.045 });
    },
    milestone() {
      [659, 880, 1319].forEach((f, i) =>
        tone(f, { type: 'triangle', dur: 0.16, gain: 0.09 - i * 0.015, delay: i * 0.06 }));
      noise({ dur: 0.3, gain: 0.03, freq: 2200, type: 'highpass', delay: 0.05 });
    },
    upgrade() {
      [392, 523, 659, 784].forEach((f, i) =>
        tone(f, { type: 'sine', dur: 0.35, gain: 0.09, delay: i * 0.055 }));
    },
    /* Capture cross-section widens your capture area, so it sweeps
       open rather than playing notes — that keeps it clear of the
       two-note accretor purchase and the four-note upgrade run.
       Pitch climbs with level, so stacking it sounds like stacking. */
    tapUp(level = 0) {
      const step = 1 + 0.05 * Math.min(level, 10);
      noise({ dur: 0.26, gain: 0.085, freq: 260 * step, q: 5.5, sweep: 3400 * step });
      tone(150 * step, { type: 'sine', dur: 0.2, gain: 0.13, glide: 300 * step, attack: 0.01 });
      tone(600 * step, { type: 'sine', dur: 0.1, gain: 0.03, delay: 0.19 });
    },
    stageUp(stage) {
      const root = 330 * Math.pow(0.975, stage);
      tone(root * 2, { type: 'triangle', dur: 0.5, gain: 0.11 });
      tone(root * 1.5, { type: 'triangle', dur: 0.6, gain: 0.09, delay: 0.09 });
      tone(root, { type: 'sine', dur: 0.95, gain: 0.15, delay: 0.18, attack: 0.02 });
      tone(root / 2, { type: 'sine', dur: 1.2, gain: 0.11, delay: 0.18, attack: 0.03 });
      noise({ dur: 0.7, gain: 0.035, freq: 400, type: 'lowpass', sweep: 2600 });
    },
    collapse() {
      tone(420, { type: 'sawtooth', dur: 1.7, gain: 0.11, glide: 34, attack: 0.05 });
      noise({ dur: 1.7, gain: 0.06, freq: 2400, type: 'lowpass', sweep: 90 });
      tone(48, { type: 'sine', dur: 1.4, gain: 0.22, delay: 1.5, attack: 0.02 });
    },
    click() { tone(1400, { type: 'triangle', dur: 0.03, gain: 0.045 }); },
  };
})();

/* ---------- game math ---------- */
const newGame = () => ({
  mass: 0, best: 0, stage: 0, gens: GENS.map(() => 0), ups: UPGRADES.map(() => false),
  tap: 0, shards: 0, shardsTotal: 0, perks: PERKS.map(() => false),
  collapses: 0, taps: 0, played: 0, lastSave: Date.now(),
  sfx: true, hum: false,
});

/* perks change these three constants; none of them compound with progress */
const offlineRate = (s) => (s.perks[1] ? 0.8 : BALANCE.offlineRate);
const tapShare = (s) => (s.perks[2] ? 0.25 : BALANCE.tapShare);
/* Stages sit ~4 decades apart early and ~1 apart late, so any fixed
   multiplier is trivial early and a huge shortcut late. Both bonuses are
   therefore expressed as a share of the gap to the next stage. */
const gapAfter = (i) => (i + 1 < TIERS.length ? Math.log10(TIERS[i + 1].at) - Math.log10(TIERS[i].at) : 1);
const stageBonus = (s, i) => Math.pow(10, (s.perks[3] ? 0.22 : BALANCE.stageShare) * gapAfter(i));
const offlineCap = (s) => Math.pow(10, BALANCE.offlineShare * gapAfter(s.stage));
const applyPerks = (s) => {
  if (s.perks[0]) { s.gens[0] = Math.max(s.gens[0], 20); s.gens[1] = Math.max(s.gens[1], 20); }
  return s;
};

const stageFor = (best) => {
  let i = 0;
  for (let j = 0; j < TIERS.length; j++) if (best >= TIERS[j].at) i = j;
  return i;
};

const upMult = (s) =>
  UPGRADES.reduce((a, u, i) => a * (s.ups[i] ? u.mult : 1), 1) *
  (1 + BALANCE.shardValue * (s.shardsTotal || 0));

const genOutput = (s, i) => {
  const c = s.gens[i];
  if (!c) return 0;
  return c * GENS[i].prod * Math.pow(GENS[i].m, Math.floor(c / BALANCE.milestoneEvery));
};
const prod = (s) => s.gens.reduce((a, _, i) => a + genOutput(s, i), 0) * upMult(s);
const tapGain = (s) => ATOM * 3 * Math.pow(2, s.tap) + prod(s) * tapShare(s);

const genCost = (i, count, n) => {
  const r = BALANCE.costGrowth;
  return GENS[i].cost * Math.pow(r, count) * (Math.pow(r, n) - 1) / (r - 1);
};
const genMax = (i, count, mass) => {
  const r = BALANCE.costGrowth;
  const base = GENS[i].cost * Math.pow(r, count);
  return Math.max(0, Math.floor(Math.log(1 + (mass * (r - 1)) / base) / Math.log(r)));
};
const tapCost = (s) => 1e-25 * Math.pow(8, s.tap);
const shardsFrom = (mass) =>
  Math.floor(BALANCE.shardRate * Math.pow(Math.max(mass, 1) / TIERS[PRESTIGE_AT].at, BALANCE.shardPower));

/* ---------- save handling ----------
   normalize() is the single place a save is validated, so a file from
   storage and a pasted save code go through identical checks. */
const SAVE_VER = 6;

const normalize = (v) => {
  const s = { ...newGame(), ...v };
  s.gens = GENS.map((_, i) => Math.max(0, Math.floor(Number(v.gens?.[i]) || 0)));
  s.ups = UPGRADES.map((_, i) => !!v.ups?.[i]);
  s.mass = Math.max(0, Number(s.mass) || 0);
  s.best = Math.max(Number(s.best) || 0, s.mass);
  s.tap = Math.max(0, Math.floor(Number(s.tap) || 0));
  s.shards = Math.max(0, Math.floor(Number(s.shards) || 0));
  s.shardsTotal = Math.max(Math.floor(Number(v.shardsTotal) || 0), s.shards);
  s.perks = PERKS.map((_, i) => !!v.perks?.[i]);
  s.collapses = Math.max(0, Math.floor(Number(s.collapses) || 0));
  s.taps = Math.max(0, Math.floor(Number(s.taps) || 0));
  s.played = Math.max(0, Number(s.played) || 0);
  s.sfx = v.sfx !== false;
  s.hum = !!v.hum;
  s.stage = stageFor(s.best);
  return s;
};

const encodeSave = (s) => {
  const json = JSON.stringify({ ...s, v: SAVE_VER });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `ACC${SAVE_VER}-${btoa(bin)}`;
};

const decodeSave = (code) => {
  const raw = String(code).trim().replace(/\s+/g, '').replace(/^ACC\d+-/, '');
  const bin = atob(raw);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const v = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof v.mass !== 'number' || !Array.isArray(v.gens)) throw new Error('not a save');
  return v;
};

const ago = (ms) => {
  if (!ms) return 'not saved yet';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return 'saved just now';
  if (s < 60) return `saved ${s}s ago`;
  return `saved ${Math.floor(s / 60)}m ago`;
};

/* ---------- the object ---------- */
function Body({ tier, size }) {
  const [a, b] = tier.c;
  const s = { width: size, height: size };

  if (tier.k === 'atom') {
    return (
      <div className="ac-body" style={s}>
        <div className="ac-orbit" style={{ animationDuration: '6s', borderColor: `${b}66` }}>
          <i style={{ background: a, boxShadow: `0 0 10px ${a}` }} />
        </div>
        <div className="ac-orbit" style={{ animationDuration: '9s', transform: 'rotate(60deg)', borderColor: `${b}55` }}>
          <i style={{ background: a, boxShadow: `0 0 10px ${a}` }} />
        </div>
        <div style={{
          width: size * 0.26, height: size * 0.26, borderRadius: '50%', zIndex: 2,
          background: `radial-gradient(circle at 35% 30%, ${a}, ${b})`,
          boxShadow: `0 0 ${size * 0.3}px ${b}`,
        }} />
      </div>
    );
  }

  if (tier.k === 'rock') {
    return (
      <div className="ac-body" style={s}>
        <div style={{
          width: size * 0.82, height: size * 0.78, position: 'relative',
          background: `radial-gradient(circle at 32% 26%, ${a}, ${b} 78%)`,
          clipPath: 'polygon(22% 4%, 62% 0%, 90% 22%, 100% 58%, 78% 92%, 40% 100%, 10% 82%, 0% 42%)',
        }}>
          <div className="ac-crater" style={{ left: '26%', top: '30%', width: size * 0.14, height: size * 0.14 }} />
          <div className="ac-crater" style={{ left: '58%', top: '20%', width: size * 0.08, height: size * 0.08 }} />
          <div className="ac-crater" style={{ left: '46%', top: '58%', width: size * 0.19, height: size * 0.19 }} />
        </div>
      </div>
    );
  }

  if (tier.k === 'planet' || tier.k === 'gas') {
    const bands = tier.k === 'gas';
    return (
      <div className="ac-body" style={s}>
        {bands && (
          <div className="ac-ring" style={{
            width: size * 1.28, height: size * 0.36, borderColor: `${a}88`, transform: 'rotate(-16deg)',
          }} />
        )}
        <div style={{
          width: size * 0.8, height: size * 0.8, borderRadius: '50%', overflow: 'hidden',
          background: bands
            ? `repeating-linear-gradient(172deg, ${a} 0 7%, ${b} 7% 13%, ${a}cc 13% 17%)`
            : `radial-gradient(circle at 34% 28%, ${a}, ${b} 76%)`,
          boxShadow: `inset -${size * 0.09}px -${size * 0.05}px ${size * 0.16}px rgba(0,0,0,.65), 0 0 ${size * 0.28}px ${b}55`,
        }} />
      </div>
    );
  }

  if (tier.k === 'neutron') {
    return (
      <div className="ac-body" style={s}>
        <div className="ac-beams" style={{ width: size * 1.5, height: size * 1.5 }}>
          <span style={{ background: `linear-gradient(to top, transparent, ${a})` }} />
          <span style={{ background: `linear-gradient(to bottom, transparent, ${a})` }} />
        </div>
        <div style={{
          width: size * 0.3, height: size * 0.3, borderRadius: '50%',
          background: `radial-gradient(circle, #fff 20%, ${a} 55%, ${b})`,
          boxShadow: `0 0 ${size * 0.5}px ${a}, 0 0 ${size * 0.9}px ${b}`,
        }} />
      </div>
    );
  }

  if (tier.k === 'hole') {
    return (
      <div className="ac-body" style={s}>
        <div className="ac-disk" style={{
          width: size * 1.35, height: size * 0.42,
          background: `conic-gradient(from 0deg, ${b}, ${a}, #fff, ${a}, ${b}, ${a}, #fff, ${b})`,
        }} />
        <div style={{
          width: size * 0.56, height: size * 0.56, borderRadius: '50%', background: '#000', zIndex: 3,
          boxShadow: `0 0 0 2px ${a}, 0 0 ${size * 0.22}px ${a}cc, 0 0 ${size * 0.7}px ${b}`,
        }} />
      </div>
    );
  }

  if (tier.k === 'galaxy') {
    return (
      <div className="ac-body" style={s}>
        <div className="ac-spiral" style={{
          width: size * 1.15, height: size * 0.5,
          background: `conic-gradient(from 0deg, transparent 0deg, ${a}cc 40deg, transparent 110deg, ${b} 180deg, transparent 250deg, ${a}aa 290deg, transparent 360deg)`,
        }} />
        <div style={{
          width: size * 0.22, height: size * 0.1, borderRadius: '50%', zIndex: 3,
          background: `radial-gradient(circle, #fff 15%, ${a} 60%, transparent)`,
          boxShadow: `0 0 ${size * 0.3}px ${a}`, transform: 'rotate(-18deg)',
        }} />
      </div>
    );
  }

  if (tier.k === 'blob') {
    return (
      <div className="ac-body" style={s}>
        <div className="ac-corona" style={{
          width: size * 1.1, height: size * 0.85,
          background: `radial-gradient(ellipse, ${a}44 25%, transparent 70%)`,
        }} />
        <div style={{
          width: size * 0.86, height: size * 0.64, borderRadius: '50%',
          background: `radial-gradient(ellipse at 45% 42%, #fff 4%, ${a} 32%, ${b} 78%, transparent)`,
          filter: 'blur(2px)', transform: 'rotate(-12deg)',
        }} />
      </div>
    );
  }

  if (tier.k === 'cluster') {
    const dots = [[50, 50, 1], [22, 34, .62], [76, 30, .55], [30, 74, .58],
                  [72, 72, .5], [50, 16, .42], [14, 58, .38], [86, 56, .4]];
    return (
      <div className="ac-body" style={s}>
        <div className="ac-slowspin" style={{ width: size, height: size, position: 'absolute' }}>
          {dots.map(([x, y, sc], i) => (
            <div key={i} style={{
              position: 'absolute', left: `${x}%`, top: `${y}%`,
              width: size * 0.15 * sc, height: size * 0.08 * sc, marginLeft: -size * 0.075 * sc,
              borderRadius: '50%', transform: `rotate(${i * 47}deg)`,
              background: `radial-gradient(circle, #fff 10%, ${a} 45%, transparent 75%)`,
              boxShadow: `0 0 ${size * 0.1}px ${b}`,
            }} />
          ))}
        </div>
        <div style={{
          width: size * 0.9, height: size * 0.9, borderRadius: '50%',
          background: `radial-gradient(circle, ${b}33 20%, transparent 68%)`,
        }} />
      </div>
    );
  }

  if (tier.k === 'web') {
    return (
      <div className="ac-body" style={s}>
        <div className="ac-slowspin" style={{ width: size, height: size, position: 'absolute' }}>
          {[12, 58, 104, 150, 32, 128].map((deg, i) => (
            <div key={i} style={{
              position: 'absolute', left: '50%', top: '50%',
              width: size * (i < 4 ? 0.92 : 0.66), height: 1.5,
              marginLeft: size * (i < 4 ? -0.46 : -0.33), transformOrigin: 'center',
              transform: `rotate(${deg}deg)`,
              background: `linear-gradient(90deg, transparent, ${a}99 30%, ${a}99 70%, transparent)`,
            }} />
          ))}
          {[[50, 50, 1], [18, 40, .6], [82, 60, .6], [38, 82, .5], [66, 20, .5]].map(([x, y, sc], i) => (
            <div key={`n${i}`} style={{
              position: 'absolute', left: `${x}%`, top: `${y}%`,
              width: size * 0.11 * sc, height: size * 0.11 * sc,
              marginLeft: -size * 0.055 * sc, marginTop: -size * 0.055 * sc, borderRadius: '50%',
              background: `radial-gradient(circle, #fff 20%, ${a} 55%, transparent)`,
              boxShadow: `0 0 ${size * 0.14}px ${b}`,
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (tier.k === 'cosmos') {
    const pts = [];
    for (let i = 0; i < 46; i++) {
      const ang = i * 2.399963, rad = Math.sqrt(i / 46) * 46;   // sunflower spiral
      pts.push([50 + rad * Math.cos(ang), 50 + rad * Math.sin(ang), 0.35 + (1 - i / 46) * 0.65]);
    }
    return (
      <div className="ac-body" style={s}>
        <div className="ac-slowspin" style={{ width: size, height: size, position: 'absolute' }}>
          {pts.map(([x, y, sc], i) => (
            <div key={i} style={{
              position: 'absolute', left: `${x}%`, top: `${y}%`,
              width: Math.max(1.5, size * 0.035 * sc), height: Math.max(1.5, size * 0.035 * sc),
              borderRadius: '50%', background: i % 5 === 0 ? '#fff' : a, opacity: 0.35 + sc * 0.6,
            }} />
          ))}
        </div>
        <div className="ac-corona" style={{
          width: size, height: size,
          background: `radial-gradient(circle, ${a}33 8%, ${b}55 38%, transparent 70%)`,
        }} />
      </div>
    );
  }

  return (
    <div className="ac-body" style={s}>
      <div className="ac-corona" style={{
        width: size * 1.05, height: size * 1.05,
        background: `radial-gradient(circle, ${a}55 30%, transparent 68%)`,
      }} />
      <div style={{
        width: size * 0.72, height: size * 0.72, borderRadius: '50%',
        background: `radial-gradient(circle at 42% 38%, #fff 6%, ${a} 40%, ${b} 88%)`,
        boxShadow: `0 0 ${size * 0.4}px ${a}, 0 0 ${size * 0.9}px ${b}aa`,
      }} />
    </div>
  );
}

function Row({ title, sub, cost, right, ok, onClick, accent, note, tint }) {
  const c = tint || accent;
  return (
    <button className="ac-row" onClick={onClick} disabled={!ok}
      style={{
        borderColor: ok ? `${c}66` : 'rgba(255,255,255,.07)',
        background: ok
          ? `linear-gradient(100deg, ${c}22, rgba(255,255,255,.04) 55%)`
          : 'rgba(255,255,255,.03)',
      }}>
      <div className="ac-bead" style={{ background: c, boxShadow: ok ? `0 0 9px ${c}cc` : 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ac-row-t">
          <span>{title}</span>
          {right ? <span style={{ color: c }}>{right}</span> : null}
        </div>
        <div className="ac-row-s">{sub}</div>
        <div className="ac-row-c" style={{ color: ok ? c : '#5b6b87' }}>
          {cost}{note ? <span className="ac-note">{note}</span> : null}
        </div>
      </div>
    </button>
  );
}

export default function Accretion() {
  const G = useRef(newGame());
  const [, render] = useState(0);
  const [tab, setTab] = useState('gen');
  const [amt, setAmt] = useState(1);
  const [pops, setPops] = useState([]);
  const [welcome, setWelcome] = useState(null);
  const [flash, setFlash] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [storageOk, setStorageOk] = useState(true);
  const [io, setIo] = useState(null);

  const stars = useMemo(
    () => Array.from({ length: 70 }, () => ({
      x: Math.random() * 100, y: Math.random() * 100,
      s: Math.random() * 1.6 + 0.4, o: Math.random() * 0.6 + 0.15, d: Math.random() * 4,
      t: Math.random() < 0.34,
    })), []);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(SAVE_KEY);
        const v = r && r.value ? JSON.parse(r.value) : null;
        if (v && typeof v.mass === 'number') {
          const s = normalize(v);
          G.current = s;
          SFX.setOn(s.sfx);
          setSavedAt(v.lastSave || null);
          const dt = clamp((Date.now() - (v.lastSave || Date.now())) / 1000, 0, BALANCE.offlineCapH * 3600);
          const raw = prod(s) * dt * offlineRate(s);
          const gain = Math.min(raw, Math.max(s.mass, ATOM) * (offlineCap(s) - 1));
          if (dt > 60 && gain > 0) { s.mass += gain; setWelcome({ dt, gain, capped: gain < raw }); }
        }
      } catch (e) { /* first run, or no storage */ }
      render((x) => x + 1);
    })();
  }, []);

  const save = useCallback(async () => {
    try {
      G.current.lastSave = Date.now();
      await window.storage.set(SAVE_KEY, JSON.stringify(G.current));
      setSavedAt(G.current.lastSave);
      setStorageOk(true);
      return true;
    } catch (e) {
      setStorageOk(false);
      return false;
    }
  }, []);

  /* advance the highest stage reached, granting the one-time bonus */
  const checkStage = (s) => {
    const st = stageFor(s.best);
    if (st > s.stage) {
      for (let i = s.stage + 1; i <= st; i++) s.mass *= stageBonus(s, i);
      s.stage = st;
      SFX.stageUp(st);
      SFX.humStage(st);
      setFlash(TIERS[st]);
      setTimeout(() => setFlash(null), 3200);
    }
  };

  useEffect(() => {
    let raf, last = performance.now(), painted = 0, saved = 0;
    const loop = (t) => {
      const dt = Math.min((t - last) / 1000, 1); last = t;
      const s = G.current;
      s.mass += prod(s) * dt;
      s.played += dt;
      if (s.mass > s.best) { s.best = s.mass; checkStage(s); }
      if (t - painted > 80) { painted = t; render((x) => x + 1); }
      if (t - saved > 12000) { saved = t; save(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const bye = () => {
      save();
      if (document.hidden) SFX.suspend(); else SFX.resume();
    };
    document.addEventListener('visibilitychange', bye);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', bye);
      SFX.hum(false);
      save();
    };
  }, [save]);

  const s = G.current;
  const tier = TIERS[s.stage];
  const next = TIERS[s.stage + 1];
  const accent = tier.c[0];
  const perSec = prod(s);

  const progress = next
    ? clamp((Math.log10(Math.max(s.best, tier.at)) - Math.log10(tier.at)) /
            (Math.log10(next.at) - Math.log10(tier.at)), 0, 1)
    : 1;

  const doTap = (e) => {
    SFX.unlock();
    SFX.setOn(s.sfx);
    if (s.hum) SFX.hum(true, s.stage);
    SFX.pull(tier.k, s.stage);
    const gain = tapGain(s);
    s.mass += gain; s.taps++;
    if (s.mass > s.best) { s.best = s.mass; checkStage(s); }
    const r = e.currentTarget.getBoundingClientRect();
    const id = Math.random();
    setPops((p) => [...p.slice(-8), {
      id, x: (e.clientX ?? r.left + r.width / 2) - r.left,
      y: (e.clientY ?? r.top + r.height / 2) - r.top, t: `+${fmt(gain)}`,
    }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 850);
  };

  const buyGen = (i) => {
    const n = amt === -1 ? genMax(i, s.gens[i], s.mass) : amt;
    if (n < 1) return;
    const c = genCost(i, s.gens[i], n);
    if (c > s.mass) return;
    const before = Math.floor(s.gens[i] / BALANCE.milestoneEvery);
    s.mass -= c; s.gens[i] += n;
    Math.floor(s.gens[i] / BALANCE.milestoneEvery) > before ? SFX.milestone() : SFX.buy();
    render((x) => x + 1);
  };

  const buyTap = () => {
    const c = tapCost(s);
    if (c > s.mass) return;
    s.mass -= c; s.tap++;
    SFX.tapUp(s.tap);
    render((x) => x + 1);
  };

  const buyUp = (i) => {
    if (s.ups[i] || UPGRADES[i].cost > s.mass) return;
    s.mass -= UPGRADES[i].cost; s.ups[i] = true;
    SFX.upgrade();
    render((x) => x + 1);
  };

  const collapse = () => {
    const got = shardsFrom(s.best);
    if (got < 1) return;
    SFX.collapse();
    G.current = applyPerks({
      ...newGame(),
      shards: s.shards + got,
      shardsTotal: (s.shardsTotal || 0) + got,
      perks: s.perks.slice(),
      collapses: s.collapses + 1,
      taps: s.taps, played: s.played, sfx: s.sfx, hum: s.hum,
    });
    SFX.humStage(0);
    setConfirm(false); setTab('gen'); save(); render((x) => x + 1);
  };

  const buyPerk = (i) => {
    if (s.perks[i] || PERKS[i].cost > s.shards) return;
    s.shards -= PERKS[i].cost;
    s.perks[i] = true;
    applyPerks(s);
    SFX.upgrade();
    save(); render((x) => x + 1);
  };

  const toggleSfx = () => {
    SFX.unlock();
    s.sfx = !s.sfx;
    SFX.setOn(s.sfx);
    if (s.sfx) { SFX.click(); if (s.hum) SFX.hum(true, s.stage); }
    save(); render((x) => x + 1);
  };

  const toggleHum = () => {
    SFX.unlock();
    s.hum = !s.hum;
    SFX.setOn(s.sfx);
    SFX.hum(s.hum, s.stage);
    save(); render((x) => x + 1);
  };

  const saveNow = async () => {
    SFX.click();
    const ok = await save();
    setIo(null);
    if (!ok) setIo({ mode: 'export', text: encodeSave(G.current), msg: 'Storage is unavailable here. Keep this code somewhere safe.' });
    render((x) => x + 1);
  };

  const openExport = async () => {
    SFX.click();
    await save();
    setIo({ mode: 'export', text: encodeSave(G.current), msg: '' });
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(io.text);
      setIo({ ...io, msg: 'Copied to clipboard.' });
    } catch (e) {
      setIo({ ...io, msg: 'Clipboard blocked — select the text and copy it.' });
    }
  };

  const doImport = () => {
    try {
      const v = decodeSave(io.text);
      const loaded = normalize(v);
      loaded.lastSave = Date.now();          // no free offline windfall on import
      G.current = loaded;
      SFX.setOn(loaded.sfx);
      SFX.hum(loaded.hum && loaded.sfx, loaded.stage);
      SFX.upgrade();
      setIo(null); setTab('gen'); setWipe(false);
      save(); render((x) => x + 1);
    } catch (e) {
      setIo({ ...io, msg: "That code couldn't be read. Paste the whole thing, including the ACC6- prefix." });
    }
  };

  const size = Math.min(74 + s.stage * 2.7, 178);
  const visible = GENS.map((g, i) => i).filter((i) => i < 2 || s.best >= GENS[i].cost * 0.2 || s.gens[i] > 0);
  const openUps = UPGRADES.map((u, i) => i).filter((i) => !s.ups[i] && s.best >= UPGRADES[i].cost * 0.15);

  return (
    <div className="ac-app" style={{
      background: `radial-gradient(130% 90% at 50% -8%, ${tier.c[1]}44 0%, #0b1224 34%, #06090f 68%, #03050b 100%)`,
    }}>
      <div className="ac-aura" style={{ background: `radial-gradient(circle, ${tier.c[0]}26, transparent 68%)`, left: '-32%', top: '4%' }} />
      <div className="ac-aura" style={{ background: `radial-gradient(circle, ${tier.c[1]}3a, transparent 68%)`, right: '-38%', bottom: '6%' }} />
      <style>{`
        .ac-app{position:relative;min-height:100vh;transition:background 1.4s ease;
          color:#e8edf7;font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden;
          display:flex;flex-direction:column;padding:14px 14px 18px;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        .ac-app *{box-sizing:border-box}
        .ac-app button{font-variant-numeric:tabular-nums}
        .ac-aura{position:absolute;width:78vw;height:78vw;max-width:430px;max-height:430px;border-radius:50%;
          filter:blur(34px);pointer-events:none;transition:background 1.4s ease}
        .ac-star{position:absolute;border-radius:50%;animation:tw 4s ease-in-out infinite}
        .ac-bead{width:3px;border-radius:3px;flex-shrink:0;align-self:stretch}
        .ac-grad{-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
        @keyframes tw{0%,100%{opacity:.2}50%{opacity:1}}
        .ac-mass{font-size:33px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
        .ac-sub{font-size:11.5px;color:#8496b5;font-variant-numeric:tabular-nums}
        .ac-tier{font-size:15px;font-weight:600}
        .ac-blurb{font-size:11.5px;color:#7d8ca8;line-height:1.45;max-width:48ch}
        .ac-stage{position:relative;z-index:2;flex:1;display:flex;align-items:center;justify-content:center;min-height:180px;
          touch-action:manipulation;user-select:none;cursor:pointer}
        .ac-stage:active{transform:scale(.97)}
        .ac-body{position:relative;display:flex;align-items:center;justify-content:center;animation:float 7s ease-in-out infinite}
        @keyframes float{0%,100%{transform:translateY(-4px)}50%{transform:translateY(5px)}}
        .ac-orbit{position:absolute;inset:8%;border:1.5px solid;border-radius:50%;animation:spin linear infinite}
        .ac-orbit i{position:absolute;top:-3px;left:50%;width:6px;height:6px;border-radius:50%}
        .ac-orbit:nth-child(2){animation-direction:reverse}
        @keyframes spin{to{transform:rotate(360deg)}}
        .ac-crater{position:absolute;border-radius:50%;background:rgba(0,0,0,.34);box-shadow:inset 1px 1px 2px rgba(255,255,255,.14)}
        .ac-ring{position:absolute;border:2px solid;border-radius:50%;opacity:.75}
        .ac-corona{position:absolute;border-radius:50%;animation:breathe 4s ease-in-out infinite}
        @keyframes breathe{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.12);opacity:1}}
        .ac-disk{position:absolute;border-radius:50%;filter:blur(5px);opacity:.92;animation:spin 3.4s linear infinite;
          mask:radial-gradient(circle,transparent 26%,#000 34%);-webkit-mask:radial-gradient(circle,transparent 26%,#000 34%)}
        .ac-spiral{position:absolute;border-radius:50%;filter:blur(4px);opacity:.9;
          animation:spin 14s linear infinite;transform:rotate(-18deg)}
        .ac-slowspin{animation:spin 40s linear infinite}
        .ac-beams{position:absolute;animation:spin 5s linear infinite}
        .ac-beams span{position:absolute;left:50%;width:3px;height:44%;margin-left:-1.5px;opacity:.7;filter:blur(1px)}
        .ac-beams span:first-child{top:0}.ac-beams span:last-child{bottom:0}
        .ac-pop{position:absolute;font-size:13px;font-weight:600;pointer-events:none;animation:rise .85s ease-out forwards;
          font-variant-numeric:tabular-nums;text-shadow:0 0 8px rgba(0,0,0,.8)}
        @keyframes rise{to{transform:translateY(-46px);opacity:0}}
        .ac-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
        .ac-bar>div{height:100%;border-radius:3px;transition:width .25s}
        .ac-bar{box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
        .ac-toggles{display:flex;gap:5px;flex-shrink:0}
        .ac-toggles button{padding:4px 9px;border-radius:99px;border:1px solid rgba(255,255,255,.1);
          background:transparent;color:#5b6b87;font-size:10.5px;font-weight:600;font-family:inherit;letter-spacing:.03em}
        .ac-toggles button.on{color:#e8edf7;border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.09)}
        .ac-tabs{display:flex;gap:6px;margin:12px 0 8px}
        .ac-tab{flex:1;padding:8px 0;border-radius:10px;border:none;font-size:12.5px;font-weight:600;
          background:rgba(255,255,255,.05);color:#8496b5;font-family:inherit}
        .ac-tab.on{background:rgba(255,255,255,.13);color:#fff}
        .ac-tab.tinted{color:#fff}
        .ac-list{height:min(37vh,282px);overflow-y:auto;display:flex;flex-direction:column;gap:7px;padding-right:2px;
          -webkit-overflow-scrolling:touch}
        .ac-row{display:flex;gap:10px;text-align:left;width:100%;padding:9px 11px;border-radius:12px;border:1px solid;
          background:rgba(255,255,255,.035);color:inherit;font-family:inherit}
        .ac-row:disabled{opacity:.45}
        .ac-row:active:not(:disabled){background:rgba(255,255,255,.1)}
        .ac-row-t{display:flex;justify-content:space-between;gap:8px;font-size:13.5px;font-weight:600}
        .ac-row-s{font-size:11px;color:#7d8ca8;margin-top:1px}
        .ac-row-c{font-size:11.5px;margin-top:4px;font-variant-numeric:tabular-nums;font-weight:600}
        .ac-note{color:#64748b;font-weight:500;margin-left:8px}
        .ac-amt{display:flex;gap:5px;margin-bottom:7px}
        .ac-amt button{padding:5px 10px;border-radius:8px;border:none;font-size:11.5px;font-weight:600;font-family:inherit;
          background:rgba(255,255,255,.06);color:#8496b5}
        .ac-amt button.on{color:#04060d;font-weight:700}
        .ac-code{width:100%;height:92px;margin-top:10px;padding:9px;border-radius:10px;resize:none;
          background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);color:#c8d4e8;
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.45;
          word-break:break-all;-webkit-user-select:text;user-select:text}
        .ac-modal{position:absolute;inset:0;background:rgba(3,6,14,.84);backdrop-filter:blur(6px);display:flex;
          align-items:center;justify-content:center;padding:26px;z-index:20}
        .ac-card{background:#0c1526;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:18px;max-width:320px}
        .ac-btn{width:100%;margin-top:12px;padding:11px;border-radius:11px;border:none;font-size:13.5px;font-weight:600;
          font-family:inherit;color:#04060d}
        .ac-flash{position:absolute;left:0;right:0;top:62px;display:flex;justify-content:center;pointer-events:none;z-index:15}
        .ac-flash>div{padding:8px 16px;border-radius:99px;font-size:12.5px;font-weight:600;
          background:rgba(6,10,22,.92);border:1px solid;animation:flash 3.2s ease-out forwards}
        @keyframes flash{0%{opacity:0;transform:translateY(8px)}12%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
        @media (prefers-reduced-motion:reduce){.ac-app *{animation-duration:0s!important}}
      `}</style>

      {stars.map((st, i) => (
        <div key={i} className="ac-star" style={{
          left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s,
          opacity: st.o, animationDelay: `${st.d}s`,
          background: st.t ? tier.c[0] : '#fff',
          boxShadow: st.t ? `0 0 4px ${tier.c[0]}` : 'none',
        }} />
      ))}

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div className="ac-tier" style={{ color: accent }}>{tier.n}</div>
          <div className="ac-toggles">
            <button className={s.sfx ? 'on' : ''} onClick={toggleSfx} aria-label="Sound effects"
              style={s.sfx ? { color: accent, borderColor: `${accent}66`, background: `${accent}1f` } : undefined}>sfx</button>
            <button className={s.sfx && s.hum ? 'on' : ''} onClick={toggleHum} aria-label="Ambient hum"
              style={s.sfx && s.hum ? { color: accent, borderColor: `${accent}66`, background: `${accent}1f` } : undefined}>hum</button>
          </div>
        </div>
        <div className="ac-mass">
          <span className="ac-grad" style={{
            backgroundImage: `linear-gradient(96deg, ${tier.c[0]} 0%, #ffffff 48%, ${tier.c[0]} 100%)`,
          }}>{fmt(s.mass)}</span>
          <span style={{ fontSize: 15, color: '#8496b5', fontWeight: 500 }}> kg</span>
        </div>
        <div className="ac-sub">
          {altMass(s.mass)} · <span style={{ color: accent }}>{fmt(perSec)} kg/s</span> · heaviest {fmt(s.best)} kg
        </div>
      </div>

      <div className="ac-stage" onPointerDown={doTap} role="button" tabIndex={0} aria-label="Pull in mass">
        <Body tier={tier} size={size} />
        {pops.map((p) => (
          <div key={p.id} className="ac-pop" style={{ left: p.x, top: p.y, color: accent }}>{p.t}</div>
        ))}
      </div>

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div className="ac-blurb" style={{ marginBottom: 7 }}>{tier.d}</div>
        <div className="ac-bar">
          <div style={{
            width: `${progress * 100}%`,
            background: `linear-gradient(90deg, ${tier.c[1]}, ${accent}${next ? `, ${next.c[0]}` : ''})`,
            boxShadow: `0 0 10px ${accent}88`,
          }} />
        </div>
        <div className="ac-sub" style={{ marginTop: 5, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: next ? `${next.c[0]}cc` : accent }}>
            {next ? `Next: ${next.n}` : 'Nothing left to absorb'}
          </span>
          <span>{next ? `${fmt(next.at)} kg` : `${s.stage + 1}/${TIERS.length}`}</span>
        </div>
      </div>

      <div className="ac-tabs">
        {[['gen', 'Accretors'], ['up', 'Physics'], ['stat', 'Log']].map(([k, label]) => (
          <button key={k} className={`ac-tab${tab === k ? ' on' : ''}`}
            style={tab === k ? {
              background: `linear-gradient(160deg, ${accent}33, ${tier.c[1]}44)`,
              color: accent, boxShadow: `inset 0 0 0 1px ${accent}55`,
            } : undefined}
            onClick={() => { SFX.click(); setTab(k); }}>{label}</button>
        ))}
      </div>

      {tab === 'gen' && (
        <>
          <div className="ac-amt">
            {[[1, 'Buy 1'], [10, 'Buy 10'], [-1, 'Buy max']].map(([v, l]) => (
              <button key={v} className={amt === v ? 'on' : ''}
                style={amt === v ? { background: accent } : undefined}
                onClick={() => setAmt(v)}>{l}</button>
            ))}
          </div>
          <div className="ac-list">
            {visible.map((i) => {
              const owned = s.gens[i];
              const n = amt === -1 ? Math.max(genMax(i, owned, s.mass), 1) : amt;
              const c = genCost(i, owned, n);
              const toMs = BALANCE.milestoneEvery - (owned % BALANCE.milestoneEvery);
              return (
                <Row key={i} accent={accent} tint={GENS[i].c} ok={c <= s.mass} onClick={() => buyGen(i)}
                  title={GENS[i].n} sub={GENS[i].d} right={owned ? `${owned}` : ''}
                  cost={`${fmt(c)} kg${n > 1 ? ` · ${n}×` : ''}`}
                  note={owned
                    ? `+${fmt(genOutput(s, i) * upMult(s))} kg/s · ×${GENS[i].m} in ${toMs}`
                    : `+${fmt(GENS[i].prod * upMult(s))} kg/s each`}
                />
              );
            })}
            {visible.length < GENS.length && (
              <div className="ac-sub" style={{ padding: '6px 2px' }}>Heavier accretors unlock as you grow.</div>
            )}
          </div>
        </>
      )}

      {tab === 'up' && (
        <div className="ac-list">
          <Row accent={accent} tint="#fcd34d" ok={tapCost(s) <= s.mass} onClick={buyTap}
            title="Capture cross-section" sub="Doubles what one pull brings in"
            right={`lv ${s.tap}`} cost={`${fmt(tapCost(s))} kg`} note={`pull = ${fmt(tapGain(s))} kg`} />

          {openUps.map((i) => (
            <Row key={i} accent={accent} tint={UPGRADES[i].c} ok={UPGRADES[i].cost <= s.mass} onClick={() => buyUp(i)}
              title={UPGRADES[i].n} sub={UPGRADES[i].d}
              cost={`${fmt(UPGRADES[i].cost)} kg`} note={`×${UPGRADES[i].mult} to everything`} />
          ))}

          <div style={{ padding: '10px 11px', borderRadius: 12, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)' }}>
            <div className="ac-row-t" style={{ marginBottom: 3 }}>
              <span>Gravitational collapse</span>
              <span style={{ color: SHARD_C }}>{s.shards} shards</span>
            </div>
            <div className="ac-row-s">
              Once you are supermassive you can collapse back to hydrogen. Everything resets except shards. Every shard you have ever earned adds 15% output permanently, and they also buy the perks below.
            </div>
            {s.stage >= PRESTIGE_AT ? (
              <button className="ac-btn" style={{ background: accent }} onClick={() => setConfirm(true)}>
                Collapse for {shardsFrom(s.best)} shards
              </button>
            ) : (
              <div className="ac-row-c" style={{ color: '#64748b' }}>Unlocks at {fmt(TIERS[PRESTIGE_AT].at)} kg</div>
            )}
          </div>

          {(s.shardsTotal > 0) && (
            <>
              <div className="ac-sub" style={{ padding: '8px 2px 2px' }}>
                Shard perks · <span style={{ color: SHARD_C }}>{s.shards} to spend</span>
              </div>
              {PERKS.map((p, i) => (
                <Row key={i} accent={accent} tint={SHARD_C} ok={!s.perks[i] && p.cost <= s.shards}
                  onClick={() => buyPerk(i)} title={p.n} sub={p.d}
                  right={s.perks[i] ? 'owned' : ''}
                  cost={s.perks[i] ? 'Active' : `${p.cost} shards`} />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'stat' && (
        <div className="ac-list">
          {[
            ['Heaviest reached', `${fmt(s.best)} kg`],
            ['Stages passed', `${s.stage + 1} of ${TIERS.length}`],
            ['Output', `${fmt(perSec)} kg/s`],
            ['Output multiplier', `×${fmt(upMult(s))}`],
            ['Accretors owned', `${s.gens.reduce((a, b) => a + b, 0)}`],
            ['Pulls', `${s.taps}`],
            ['Collapses', `${s.collapses}`],
            ['Shards earned', `${s.shardsTotal || 0}`],
            ['Time in this universe', `${Math.floor(s.played / 60)}m ${Math.floor(s.played % 60)}s`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 11px', fontSize: 12.5 }}>
              <span style={{ color: '#7d8ca8' }}>{k}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: k === 'Shards earned' ? SHARD_C : accent }}>{v}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,.07)', margin: '6px 0 2px' }} />
          <div className="ac-sub" style={{ padding: '4px 11px' }}>
            {storageOk
              ? `Autosaves every 12 seconds · ${ago(savedAt)}`
              : 'Autosave is unavailable here — export a code to keep your progress.'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ac-tab" onClick={saveNow}>Save now</button>
            <button className="ac-tab" onClick={openExport}>Export</button>
            <button className="ac-tab" onClick={() => { SFX.click(); setIo({ mode: 'import', text: '', msg: '' }); }}>Import</button>
          </div>
          <button className="ac-tab" style={{ marginTop: 2 }}
            onClick={() => { if (wipe) { G.current = newGame(); SFX.hum(false); setWipe(false); save(); } else setWipe(true); }}>
            {wipe ? 'Tap again to erase everything' : 'Start over'}
          </button>
        </div>
      )}

      {flash && (
        <div className="ac-flash">
          <div style={{ borderColor: `${flash.c[0]}66`, color: flash.c[0] }}>
            {flash.n} · +{Math.round((stageBonus(s, s.stage) - 1) * 100)}% mass
          </div>
        </div>
      )}

      {welcome && (
        <div className="ac-modal" onClick={() => setWelcome(null)}>
          <div className="ac-card">
            <div className="ac-tier" style={{ color: accent }}>You kept accreting</div>
            <div className="ac-blurb" style={{ marginTop: 6 }}>
              {Math.floor(welcome.dt / 3600)}h {Math.floor((welcome.dt % 3600) / 60)}m away.
              {welcome.capped ? ' Offline growth carries you part of the way to the next stage, never past it.' : ''}
            </div>
            <div className="ac-mass" style={{ fontSize: 22, marginTop: 10 }}>+{fmt(welcome.gain)} kg</div>
            <button className="ac-btn" style={{ background: accent }} onClick={() => setWelcome(null)}>Keep going</button>
          </div>
        </div>
      )}

      {io && (
        <div className="ac-modal" onClick={() => setIo(null)}>
          <div className="ac-card" onClick={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <div className="ac-tier" style={{ color: accent }}>
              {io.mode === 'export' ? 'Your save code' : 'Paste a save code'}
            </div>
            <div className="ac-blurb" style={{ marginTop: 6 }}>
              {io.mode === 'export'
                ? 'Keep this somewhere safe. Pasting it back restores this exact run.'
                : 'This replaces your current progress. Export first if you want to keep it.'}
            </div>
            <textarea className="ac-code" value={io.text} spellCheck={false}
              readOnly={io.mode === 'export'}
              onFocus={(e) => io.mode === 'export' && e.target.select()}
              onChange={(e) => setIo({ ...io, text: e.target.value, msg: '' })}
              placeholder={io.mode === 'import' ? 'ACC6-…' : undefined} />
            {io.msg ? <div className="ac-sub" style={{ marginTop: 6 }}>{io.msg}</div> : null}
            {io.mode === 'export' ? (
              <button className="ac-btn" style={{ background: accent }} onClick={copyCode}>Copy code</button>
            ) : (
              <button className="ac-btn" style={{ background: accent, opacity: io.text.trim() ? 1 : 0.4 }}
                onClick={doImport} disabled={!io.text.trim()}>Load this save</button>
            )}
            <button className="ac-tab" style={{ width: '100%', marginTop: 8 }} onClick={() => setIo(null)}>Close</button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="ac-modal" onClick={() => setConfirm(false)}>
          <div className="ac-card" onClick={(e) => e.stopPropagation()}>
            <div className="ac-tier" style={{ color: accent }}>Collapse the universe?</div>
            <div className="ac-blurb" style={{ marginTop: 6 }}>
              Everything returns to a single hydrogen atom. You keep {s.shards + shardsFrom(s.best)} shards,
              worth ×{fmt(1 + BALANCE.shardValue * ((s.shardsTotal || 0) + shardsFrom(s.best)))} output on the next run, and spendable on perks.
            </div>
            <button className="ac-btn" style={{ background: accent }} onClick={collapse}>Collapse</button>
            <button className="ac-tab" style={{ width: '100%', marginTop: 8 }} onClick={() => setConfirm(false)}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  );
}
