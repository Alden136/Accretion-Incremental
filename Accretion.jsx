import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';

/* ============================================================
   ACCRETION — an incremental game about mass

   Economy notes (every figure below is simulated before shipping):
   - Cost grows 1.15x per level; production milestones give x3.4
     every 10 levels. Cost wins slightly (payback +1.75%/level),
     so no accretor can run away on its own.
   - Accretors sit every ~2.3 stages instead of every ~5 decades.
     The old spacing let one accretor (Fusion Core) span eight
     stages, so the whole planet-to-star run had no pacing control.
   - Each accretor carries its own yield, solved numerically against
     the pacing target below. Payback rises monotonically down the
     ladder — 7s for the foam sifter to ~3h for the horizon harvest.
     A yield that dips (the old Horizon trawler paid back in 91s,
     faster than five cheaper accretors) makes the late game
     re-accelerate instead of settling.
   - Act two (galaxy onward) exists because one black hole cannot
     grow past ~5e10 solar masses; above that its disk fragments
     into stars. So the ladder becomes bound structure instead.
   - Stage bonuses are ONE-TIME mass grants, never permanent
     production multipliers. Production is the only source of mass,
     and every price is denominated in mass, so a permanent global
     multiplier of x divides the whole run length by exactly x.
     The shard bonus is the only permanent one, and it is bought
     rather than granted: every level costs 45% more shards than
     the last while giving the same +15%, so the EFFECT never
     diminishes but the pace does. That geometric cost is what
     keeps it safe -- an early version handed out +15% per shard
     earned, free, and one collapse ended the game in four minutes.
     A saturating free bonus fixed that but walled out at x3 and
     made late shards worthless; this trades the wall for a cost
     curve, and makes shards a choice between raw speed and perks.
   - Stage bonus and offline windfall are fractions of the gap to
     the NEXT stage, never fixed multipliers: a fixed x1.4 was 4% of
     an early gap and 47% of the Sun-to-neutron-star gap. The gap is
     read clamped to [1.2, 3.0] decades, because the raw ladder runs
     from 0.31 decades (Sun to neutron star) to 5.0 (pebble to
     boulder), which made one stage bonus x1.09 and another x3.98.
   - Global upgrades are a bounded set of ten, x58 in total.
   - The pull track is bounded too, but it is priced to run the whole
     ladder: 40 levels, each +0.5% of a second's output, the last one
     costing about what the last global upgrade costs. It used to
     double a flat kg figure against a cost growing 8x, so it was dead
     weight by the third level while still asking to be bought; then it
     was ten levels at 8x, which finished two minutes into an eight-hour
     run and read "Maxed" for the other seven and a half hours.
   - Offline is capped per hour away, not by one flat fraction of a
     stage. Flat, the cap bound about half an hour in, so hours two
     through eight of any absence earned nothing while the game still
     advertised an eight-hour window. Eight hours is now ~1.5 stages.
   - Pacing target is a geometric ramp, ~35s for the first stage to
     ~53 min for the last. The ramp carries the length: the opening
     stays as quick as it ever was and the back half does the work,
     because a run this long cannot afford a slow first minute.
   Simulated result: ~1 min/stage in the rock era, ~7 min planets-to-
   stars, ~18 min black holes, ~34 min galaxies-to-universe; ~8 h
   first run, settling to ~2.7 h once the shard cap is reached.
   ============================================================ */

const BALANCE = {
  costGrowth: 1.15,
  milestoneEvery: 10,
  stageShare: 0.12,   // stage bonus = this fraction of the way to the NEXT stage
  offlineShare: 0.19, // offline cap, in gaps-to-the-next-stage, PER HOUR away
  offlineShareDeep: 0.28, // ...and with the Deep time perk
  gapMin: 1.2,        // both bonuses read the gap to the next stage clamped to
  gapMax: 3.0,        // this range, so neither a 0.31- nor a 5.0-decade step rules
  tapShare: 0.1,      // fraction of a second's output per tap
  tapStep: 0.005,     // each pull upgrade adds this much to that fraction
  tapLevels: 40,      // over a track that spans the ladder, not the first minute
  tapBase: 1e-25,     // first pull upgrade costs this...
  tapGrowth: 90,      // ...and each one after it costs this much more again
  offlineRate: 0.5,
  offlineCapH: 8,
  shardRate: 2,
  shardPower: 0.07,
  densBase: 2,        // the first density level costs this many shards...
  densGrowth: 1.45,   // ...and each one after it costs this much more again
  densStep: 1.15,     // and each one multiplies output by this, compounding
};

const ATOM = 1.67e-27;
const SUN = 1.989e30;
const EARTH = 5.972e24;
const SAVE_KEY = 'accretion_save_v6';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
  { n: 'Dwarf planet',       at: 1.31e22, k: 'dwarf',   c: ['#e8c493', '#6b3f1f'], d: 'Pluto-class. Round under its own gravity at last.' },
  { n: 'Terrestrial planet', at: EARTH,   k: 'world',   c: ['#38bdf8', '#047857'], d: 'One Earth mass. Enough pull to keep an atmosphere.' },
  { n: 'Ice giant',          at: 1.02e26, k: 'ice',     c: ['#7dd3fc', '#075985'], d: 'Neptune-class. Supersonic winds over a mantle of hot ice.' },
  { n: 'Gas giant',          at: 1.90e27, k: 'gas',     c: ['#fcd34d', '#b45309'], d: 'Jupiter-class. Hydrogen turns metallic in the core.' },
  { n: 'Brown dwarf',        at: 2.5e28,  k: 'ember',   c: ['#fb923c', '#7c2d12'], d: 'Thirteen Jupiters. Fuses deuterium, and little else.' },
  { n: 'Red dwarf',          at: 1.6e29,  k: 'star',    c: ['#f87171', '#7f1d1d'], d: 'Fully convective and frugal. Good for a trillion years.' },
  { n: 'Sun-like star',      at: SUN,     k: 'star',    c: ['#fde68a', '#f59e0b'], d: 'One solar mass, burning hydrogen on the main sequence.' },
  { n: 'Neutron star',       at: 4.1e30,  k: 'neutron', c: ['#e0f2fe', '#38bdf8'], d: 'PSR J0740+6620: two solar masses packed into twenty kilometres.' },
  { n: 'Blue supergiant',    at: 4e31,    k: 'star',    c: ['#bfdbfe', '#2563eb'], d: 'Twenty solar masses, spent in ten million years.' },
  { n: 'Stellar black hole', at: 2e32,    k: 'hole',    c: ['#a78bfa', '#1e1b4b'], d: 'The core lost its argument with gravity.',
    h: { r: 0.34, disk: 0.78, dh: 0.30, spin: 2.0, ring: 0.35, glow: 0.8, feed: 'companion' } },
  { n: 'Intermediate hole',  at: 2e33,    k: 'hole',    c: ['#c084fc', '#2e1065'], d: 'A thousand suns. Rare, and mostly still hypothetical.',
    h: { r: 0.42, disk: 0.88, dh: 0.34, spin: 2.8, ring: 0.5, feed: 'cluster' } },
  { n: 'Seed hole',          at: 1e35,    k: 'hole',    c: ['#d8b4fe', '#3b0764'], d: 'Half a million suns, waiting for a galaxy to form around it.',
    h: { r: 0.48, disk: 0.72, dh: 0.50, diskOp: 0.4, spin: 6.5, ring: 0.5, glow: 0.7, feed: 'dust' } },
  { n: 'Supermassive hole',  at: 8.5e36,  k: 'hole',    c: ['#f0abfc', '#4a044e'], d: 'Sagittarius A*, anchoring everything you can see.',
    h: { r: 0.52, disk: 1.05, dh: 0.40, spin: 4.2, ring: 0.7, feed: 'orbits' } },
  { n: 'Quasar engine',      at: 1e39,    k: 'hole',    c: ['#f5d0fe', '#701a75'], d: 'Feeding hard enough to outshine its host galaxy.',
    h: { r: 0.40, disk: 0.96, dh: 0.25, diskOp: 1, spin: 11, ring: 1.0, glow: 1.35, jet: 1 } },
  { n: 'Ultramassive hole',  at: 1.3e41,  k: 'hole',    c: ['#fbcfe8', '#f472b6'], d: 'TON 618. Sixty-six billion suns — near the ceiling for any one hole.',
    h: { r: 0.70, disk: 1.30, dh: 0.30, diskOp: 0.55, spin: 9.0, ring: 1.0, glow: 0.9 } },

  /* Act two. A single black hole cannot grow much past TON 618: above
     roughly 5e10 solar masses the accretion disk fragments into stars
     instead of feeding the hole. So the ladder stops being one object
     and becomes bound structure. Masses include dark matter halos. */
  { n: 'Spiral galaxy',      at: 3e42,    k: 'galaxy',  c: ['#bfdbfe', '#1e3a8a'], d: 'Milky Way-class. A hundred billion stars around your hole.' },
  { n: 'Giant elliptical galaxy', at: 2e44, k: 'elliptical', c: ['#fde68a', '#78350f'], d: 'IC 1101: a hundred trillion suns, and no arms left to speak of.' },
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
   carries its own yield, solved numerically against the pacing target
   in the header. Two rules hold the solution together: yields fall
   monotonically down the ladder (so payback only ever grows, and the
   late game settles instead of re-accelerating), and every accretor
   is reachable — the last one used to cost 1e52 for a 2500s payback,
   which no run ever got far enough to want. */
const GENS = [
  { n: 'Quantum foam sifter',   d: 'Skims virtual pairs out of empty space',   cost: 1e-26, y: 0.15, m: 3.4, c: '#93c5fd' },
  { n: 'Molecular binder',      d: 'Chemistry, run at a profit',               cost: 1e-19, y: 0.049, m: 3.4, c: '#a5b4fc' },
  { n: 'Dust accreter',         d: 'Sweeps grains from a cold nebula',         cost: 1e-11, y: 0.049, m: 3.4, c: '#cbd5e1' },
  { n: 'Electrostatic clumper', d: 'Static charge welds dust into gravel',     cost: 1e-2,  y: 0.01, m: 3.4, c: '#d6d3d1' },
  { n: 'Gravity well',          d: 'Mass finally starts attracting mass',      cost: 1e6,   y: 0.005, m: 3.4, c: '#fbbf24' },
  { n: 'Runaway accreter',      d: 'The biggest body eats fastest',            cost: 1e11,  y: 0.0028, m: 3.4, c: '#f59e0b' },
  { n: 'Orbital dredge',        d: 'Clears the neighbourhood, permanently',    cost: 1e16,  y: 0.00036, m: 3.4, c: '#f97316' },
  { n: 'Planetary sweeper',     d: 'Bends whole orbits into your path',        cost: 1e20,  y: 0.00016, m: 3.4, c: '#38bdf8' },
  { n: 'Atmosphere harvester',  d: 'Strips hydrogen and helium from the disk', cost: 1e25,  y: 0.00016, m: 3.4, c: '#67e8f9' },
  { n: 'Stellar nursery',       d: 'Collapses a molecular cloud on demand',    cost: 1e28,  y: 0.00016, m: 3.4, c: '#fb923c' },
  { n: 'Fusion core',           d: 'Burns hydrogen and hoards the ash',        cost: 1e30,  y: 0.00016, m: 3.25, c: '#fde68a' },
  { n: 'Degenerate press',      d: 'Packs matter past what electrons allow',   cost: 1e32,  y: 0.00016, m: 3.15, c: '#e0f2fe' },
  { n: 'Accretion disk',        d: 'Infall at a tenth of light speed',         cost: 1e34,  y: 0.00016, m: 3.05, c: '#c084fc' },
  { n: 'Horizon trawler',       d: 'Swallows star systems whole',              cost: 1e38,  y: 0.00015, m: 2.95, c: '#f0abfc' },
  { n: 'Merger cascade',        d: 'Two holes become one, over and over',      cost: 1e41,  y: 9.8e-05, m: 2.9, c: '#f472b6' },
  { n: 'Halo assembler',        d: 'Binds dark matter into a halo around you', cost: 1e44,  y: 5.9e-05, m: 2.85, c: '#818cf8' },
  { n: 'Cluster infall',        d: 'Whole galaxies arrive on radial orbits',   cost: 1e47,  y: 3.1e-05, m: 2.8, c: '#c4b5fd' },
  { n: 'Filament siphon',       d: 'Draws matter down the cosmic web',         cost: 5e49,  y: 1.1e-05, m: 2.75, c: '#5eead4' },
  { n: 'Horizon harvest',       d: 'Gathers everything light can still reach', cost: 1e52,  y: 1.1e-05, m: 2.7, c: '#ffffff' },
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

/* Spent with collapse shards; bounded, and none of them compound.
   Priced by simulated strength, not by position in the list: Tidal
   capture is worth ~30% off a run if you actually tap, Fossil
   metallicity ~4%, Residual disk ~2%. The old sheet charged 14 and 24
   the other way round. */
const SHARD_C = '#f0abfc';
const PERKS = [
  { n: 'Residual disk',       d: 'Raises your first two accretors to at least level 20 now and at the start of each run', cost: 4 },
  { n: 'Deep time',           d: 'Offline accretion runs at 80% instead of 50%, and its cap fills ~50% faster', cost: 8 },
  { n: 'Tidal capture',       d: 'Each pull adds 0.25 seconds of production instead of 0.1, plus its base mass',   cost: 22 },
  { n: 'Fossil metallicity',  d: 'Increases the one-time mass bonus at each new stage; the multiplier depends on the spacing to the following stage',   cost: 12 },
  { n: 'Frozen physics',      d: 'Keep the first five physics upgrades you have bought through a collapse', cost: 10 },
  { n: 'Long drift',          d: 'Offline accretion keeps earning for 24 hours away instead of 8',          cost: 14 },
  { n: 'Self-assembly',       d: 'Buys the best-value accretor for you whenever you can afford it',         cost: 18 },
  { n: 'Tidal resonance',     d: 'Pulls fire on their own, once a second, without you touching anything',   cost: 30 },
];
/* Self-assembly is the one perk you can switch off after buying it: it is the
   only one that SPENDS for you, so there are real moments -- saving for a
   physics upgrade, holding mass to cross a stage -- when you want it to stop.
   The rest only ever add, so they have nothing to pause. */
const AUTO_PERK = 6;

/* played carries across a collapse, so this counts a lifetime, not a run. It
   is also the hidden dev-mode tap target, and naming it once keeps the label
   and that check from drifting apart. */
const PLAY_STAT = 'Time played';

/* ---------- number formatting ---------- */
const SUPS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (s) => String(s).split('').map((c) => SUPS[c] || c).join('');

function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(n)));
  if (e >= -2 && e < 4) return n.toFixed(Math.max(0, Math.min(4, 2 - e)));
  /* toFixed rounds the mantissa, and anything from 9.995 up rounds to "10.00"
     -- which printed 10.00×10²⁰ instead of 1.00×10²¹. The mass counter crosses
     that window at every decade of an eighty-decade ladder, so carry into the
     exponent instead. */
  const x = e + (Math.abs(n) / Math.pow(10, e) >= 9.995 ? 1 : 0);
  return `${(n / Math.pow(10, x)).toFixed(2)}×10${sup(x)}`;
}

/* Runs pass eight hours, so minutes alone stopped being a sensible unit. */
function dur(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${t % 60}s`;
}

function altMass(kg) {
  if (kg >= 1e29) return `${fmt(kg / SUN)} solar masses`;
  if (kg >= 1e22) return `${fmt(kg / EARTH)} Earth masses`;
  if (kg >= 1e3) return `${fmt(kg / 1000)} tonnes`;
  if (kg >= 1e-24) return `${fmt(kg / ATOM)} hydrogen atoms`;
  return 'lighter than one atom';
}


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
      } else if (kind === 'world' || kind === 'ice' || kind === 'gas' || kind === 'dwarf' || kind === 'ember') {
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
      const step = 1 + 0.5 * Math.min(level, BALANCE.tapLevels) / BALANCE.tapLevels;
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
  tap: 0, shards: 0, shardsTotal: 0, dens: 0, perks: PERKS.map(() => false),
  collapses: 0, taps: 0, played: 0, lastSave: Date.now(),
  sfx: true, hum: false, dev: false, auto: true,
});

/* Developer mode: everything is free and nothing is hidden, so a build can be
   walked through end to end without playing eight hours of it. It is a flag on
   the save, not a build switch, so a dev save stays marked as one — the header
   shows a DEV badge and it survives a collapse. */
const devFree = (s) => !!s.dev;

/* perks change these offline constants; none of them compound with progress */
const offlineRate = (s) => (s.perks[1] ? 0.8 : BALANCE.offlineRate);
const offlineHours = (s) => (s.perks[5] ? 24 : BALANCE.offlineCapH);
const offlineShare = (s) => (s.perks[1] ? BALANCE.offlineShareDeep : BALANCE.offlineShare);
/* A pull is worth a share of a second's output — the only scale-free way
   to price it, since the ladder spans 78 decades. The upgrade moves that
   share over tapLevels purchases; the flat term only matters in the first
   few seconds of a run, before anything is producing.
   The track is priced to last: at 8x a level it finished two minutes into
   an eight-hour run and then read "Maxed" for the rest of it, spanning
   eight of the ladder's eighty decades. At 90x the last level costs
   1.6e51 kg — about what the last global upgrade costs — so a level lands
   roughly once a stage all the way to the end.
   Levels and growth are one knob, not two: growth is what fixes where the
   track ENDS, so a level can never simply be appended. Appending a 37th at
   the old 150x would have cost 2.2e53 kg, half again the mass of the whole
   finished ladder, buyable only after the game had said there was nothing
   left to absorb. Widening the track therefore means easing growth to
   match — 36 levels at 150x, then 37 at 130x, now 40 at 90x — which holds
   both ends still and fits the extra steps in between. To move the count
   again, solve tapBase * growth^(tapLevels-1) back to roughly the cost of
   the last global upgrade. */
const tapShare = (s) =>
  (s.perks[2] ? 0.25 : BALANCE.tapShare) +
  BALANCE.tapStep * Math.min(s.tap, BALANCE.tapLevels);
/* Stages sit ~4 decades apart early and ~1 apart late, so any fixed
   multiplier is trivial early and a huge shortcut late. Both bonuses are
   therefore expressed as a share of the gap to the next stage — clamped,
   because the raw gap runs from 0.31 decades to 5.0 and the ends of that
   range give a stage bonus of x1.09 (nothing) and x3.98 (a free stage). */
const gapAfter = (i) => clamp(
  i + 1 < TIERS.length ? Math.log10(TIERS[i + 1].at) - Math.log10(TIERS[i].at) : 1,
  BALANCE.gapMin, BALANCE.gapMax);
const stageBonus = (s, i) => Math.pow(10, (s.perks[3] ? 0.22 : BALANCE.stageShare) * gapAfter(i));
/* The cap grows with the length of the absence rather than being one flat
   fraction of a stage. Flat, it bound after ~30 minutes away, so hours two
   through eight of any absence earned nothing while the UI still advertised
   an eight-hour window. Eight hours is now worth ~1.5 stages, one hour ~0.2. */
const offlineCap = (s, hours) =>
  Math.pow(10, offlineShare(s) * gapAfter(s.stage) * clamp(hours, 0, offlineHours(s)));
const applyPerks = (s) => {
  if (s.perks[0]) { s.gens[0] = Math.max(s.gens[0], 20); s.gens[1] = Math.max(s.gens[1], 20); }
  return s;
};

const stageFor = (best) => {
  let i = 0;
  for (let j = 0; j < TIERS.length; j++) if (best >= TIERS[j].at) i = j;
  return i;
};

/* Primordial density: the one permanent production multiplier, and the only
   thing in the game you buy with shards besides perks. Each level compounds,
   so the return never tapers -- level forty is worth exactly as much as level
   one. What tapers is how fast you can afford them, because the cost grows
   45% a level against a shard income that only grows with the multiplier
   itself. Five levels come out of a first full run (x2.01), the old x3 wall
   falls around level eight, and it keeps paying from there without ever
   turning into a divisor that collapses the game: reaching x16 is roughly
   190 hours of play. */
const shardMult = (s) => Math.pow(BALANCE.densStep, s.dens || 0);
const densCost = (s) => Math.ceil(BALANCE.densBase * Math.pow(BALANCE.densGrowth, s.dens || 0));
/* What a pile of shards is actually worth from where you stand. Shards buy
   nothing by themselves now, so the collapse dialog quotes levels, not a
   multiplier it would otherwise be promising for free. */
const densLevelsFor = (s, shards) => {
  let n = 0, left = shards;
  for (;;) {
    const c = densCost({ dens: (s.dens || 0) + n });
    if (c > left || n > 400) return n;
    left -= c; n++;
  }
};

const upMult = (s) =>
  UPGRADES.reduce((a, u, i) => a * (s.ups[i] ? u.mult : 1), 1) * shardMult(s);

const genOutput = (s, i) => {
  const c = s.gens[i];
  if (!c) return 0;
  return c * GENS[i].prod * Math.pow(GENS[i].m, Math.floor(c / BALANCE.milestoneEvery));
};
const prod = (s) => s.gens.reduce((a, _, i) => a + genOutput(s, i), 0) * upMult(s);
const tapGain = (s) => ATOM * 3 * Math.pow(2, s.tap) + prod(s) * tapShare(s);

/* Keep actual time away separate from the time eligible for offline income. */
const applyOffline = (s, now = Date.now()) => {
  const elapsed = Number.isFinite(s.lastSave) && s.lastSave > 0
    ? Math.max(0, (now - s.lastSave) / 1000) : 0;
  const credited = Math.min(elapsed, offlineHours(s) * 3600);
  const raw = prod(s) * credited * offlineRate(s);
  const gain = Math.min(raw, Math.max(s.mass, ATOM) * (offlineCap(s, credited / 3600) - 1));
  s.mass += gain;
  s.lastSave = now;
  return { dt: elapsed, credited, gain, timeCapped: elapsed > credited, massCapped: gain < raw };
};

const genCost = (i, count, n) => {
  const r = BALANCE.costGrowth;
  return GENS[i].cost * Math.pow(r, count) * (Math.pow(r, n) - 1) / (r - 1);
};
const genMax = (i, count, mass) => {
  const r = BALANCE.costGrowth;
  const base = GENS[i].cost * Math.pow(r, count);
  return Math.max(0, Math.floor(Math.log(1 + (mass * (r - 1)) / base) / Math.log(r)));
};
/* Self-assembly's planner. It scores every accretor by time-to-break-even
   INCLUDING the wait to afford it, and buys only once the winner is already
   affordable — so it saves up for a good one instead of sinking everything
   into whatever is cheapest right now. Both a single level and a jump to the
   next milestone are considered: crossing a multiple of milestoneEvery
   multiplies that accretor by its m, so the bulk buy is usually the better
   value and skipping it is not a small loss. Simulated over a full run,
   single-level-only finishes in 21h against 7.9h with the milestone jump,
   and 7.9h is where the balance target sits — the planner reaches the
   designed pace rather than beating it. */
const autoPick = (s) => {
  const rate = prod(s) || 1e-300;
  let best = null;
  for (let i = 0; i < GENS.length; i++) {
    const owned = s.gens[i];
    const toMile = BALANCE.milestoneEvery - (owned % BALANCE.milestoneEvery);
    for (const n of new Set([1, toMile])) {
      const c = genCost(i, owned, n);
      const before = genOutput(s, i);
      s.gens[i] = owned + n;
      const after = genOutput(s, i);
      s.gens[i] = owned;
      const dp = (after - before) * upMult(s);
      if (dp <= 0) continue;
      const score = Math.max(0, (c - s.mass) / rate) + c / dp;
      if (!best || score < best.score) best = { score, i, n, c };
    }
  }
  return best && best.c <= s.mass ? best : null;
};

const tapCost = (s) => BALANCE.tapBase * Math.pow(BALANCE.tapGrowth, s.tap);
const tapMaxed = (s) => s.tap >= BALANCE.tapLevels;
const shardsFrom = (mass) =>
  Math.floor(BALANCE.shardRate * Math.pow(Math.max(mass, 1) / TIERS[PRESTIGE_AT].at, BALANCE.shardPower));

/* ---------- save handling ----------
   normalize() is the single place a save is validated, so a file from
   storage and a pasted save code go through identical checks. */
const SAVE_VER = 7;

/* Infinity is the one bad value that survived the old `Number(x) || 0` guard:
   NaN is falsy and became 0, but Infinity is truthy and passed straight
   through. JSON.parse turns an overflowing literal like 1e400 into Infinity,
   so a hand-edited save code reached normalize with mass = Infinity -- and
   genMax then returned NaN, which slipped past buyGen's `n < 1` and
   `c > s.mass` guards (both false for NaN) and wrote NaN into mass and gens. */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const normalize = (v) => {
  const s = { ...newGame(), ...v };
  s.gens = GENS.map((_, i) => Math.max(0, Math.floor(num(v.gens?.[i]))));
  s.ups = UPGRADES.map((_, i) => !!v.ups?.[i]);
  s.mass = Math.max(0, num(s.mass));
  s.best = Math.max(num(s.best), s.mass);
  s.tap = clamp(Math.floor(num(s.tap)), 0, BALANCE.tapLevels);
  s.shards = Math.max(0, Math.floor(num(s.shards)));
  s.shardsTotal = Math.max(Math.floor(num(v.shardsTotal)), s.shards);
  /* v6 and earlier had no density track: the multiplier was free, derived from
     every shard ever earned, and saturated towards x3. Grant whatever number
     of levels covers what that save already had, so nobody loses output they
     were playing with -- rounded up, so nobody loses any of it. Keyed on the
     field being absent, which makes it idempotent: once dens exists it is
     read, never recomputed. The clamp is validation, not a design cap; the
     cost curve puts level 400 thousands of hours past anything reachable, and
     it only exists so a corrupt save cannot make the multiplier Infinity. */
  s.dens = v.dens === undefined
    ? Math.ceil(Math.log(3 - 2 / (1 + 0.06 * s.shardsTotal)) / Math.log(BALANCE.densStep))
    : clamp(Math.floor(num(v.dens)), 0, 400);
  s.perks = PERKS.map((_, i) => !!v.perks?.[i]);
  s.collapses = Math.max(0, Math.floor(num(s.collapses)));
  s.taps = Math.max(0, Math.floor(num(s.taps)));
  s.played = Math.max(0, num(s.played));
  s.lastSave = num(v.lastSave, 0) > 0 ? num(v.lastSave) : Date.now();
  s.sfx = v.sfx !== false;
  s.auto = v.auto !== false;   // pausing is deliberate; absent means never paused
  s.hum = !!v.hum;
  s.dev = !!v.dev;
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
/* ---------- spiral galaxy geometry ----------
   Arms are a logarithmic spiral, r = r0*e^(b*theta) -- which is what real arms
   are, b being the tangent of the pitch angle (~0.23, about 13 degrees, is
   Milky-Way-like). This replaced a conic-gradient, and a conic gradient can
   only produce straight radial wedges: a pinwheel, not a spiral.

   Each arm is drawn twice. First a LANE of soft blobs stretched along the
   local tangent, overlapping into one continuous ribbon -- an arm is a density
   wave, lit between its stars, and a row of separate dots just reads as
   confetti. Then STARS scattered tightly along the same curve, with a few pink
   HII knots where the arm is still forming them.

   Everything is computed face-on in percentages and the renderer squashes it
   with scaleY, so the tangent angles come out right under the projection.
   Positions are fixed, never random per render, or the galaxy would shimmer. */
const GALAXY = (() => {
  const A = { arms: 4, b: 0.23, r0: 0.076, turns: 1.3, lane: 18, stars: 20, field: 26,
              thick: 0.26, scatter: 0.17 };
  let seed = 20240611;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const maxT = A.turns * 2 * Math.PI;
  const at = (th) => A.r0 * Math.exp(A.b * th);
  const rMax = at(maxT);
  const norm = (r) => Math.max(0, Math.min(1, (r - A.r0) / (rMax - A.r0)));
  const lane = [], stars = [];
  for (let a = 0; a < A.arms; a++) {
    const phase = (a / A.arms) * 2 * Math.PI;
    for (let i = 0; i < A.lane; i++) {
      const f = i / (A.lane - 1), th = f * maxT, r = at(th), dth = maxT / (A.lane - 1);
      lane.push({
        x: 50 + r * 100 * Math.cos(th + phase), y: 50 + r * 100 * Math.sin(th + phase),
        // overlap generously so blobs fuse instead of beading, and taper the
        // last third -- an untapered tip reads as a streak flung off the rim
        len: (r * dth * 2.6 + r * 0.18) * (1 - 0.22 * f * f),
        wid: r * A.thick * (1 - 0.3 * f * f),
        rot: (th + phase + Math.PI / 2 - Math.atan(A.b)) * 180 / Math.PI,
        t: norm(r), f,
      });
    }
    for (let i = 0; i < A.stars; i++) {
      const f = Math.pow(rnd(), 0.75), th = f * maxT, r = at(th);
      const off = (rnd() - 0.5) * 2;
      const rr = r + off * Math.abs(off) * A.scatter * r;
      const tt = th + phase + (rnd() - 0.5) * 0.34;
      stars.push({
        x: 50 + rr * 100 * Math.cos(tt), y: 50 + rr * 100 * Math.sin(tt),
        t: norm(rr), s: 0.8 + rnd() * 0.75, hii: rnd() < 0.08 && f > 0.3,
      });
    }
  }
  for (let i = 0; i < A.field; i++) {
    const th = rnd() * 2 * Math.PI;
    const rr = A.r0 + Math.pow(rnd(), 0.55) * (rMax - A.r0) * 1.1;
    stars.push({
      x: 50 + rr * 100 * Math.cos(th), y: 50 + rr * 100 * Math.sin(th),
      t: norm(rr), s: 0.45 + rnd() * 0.4, faint: true,
    });
  }
  return { lane, stars };
})();

/* ---------- giant elliptical ----------
   An elliptical's defining feature is the ABSENCE of structure -- no arms, no
   disk, no lanes -- so the art cannot lean on shape and has to make the light
   profile itself worth looking at.

   The profile is de Vaucouleurs, r^(1/4): a tiny ferocious core and a huge
   faint envelope, quite unlike the even smudge this replaced. It is a stack of
   nested soft ellipses rather than one steep gradient, because every layer
   fades out well inside its own box and the stack therefore has no rim
   anywhere -- a single multi-stop gradient always showed an edge where its
   last stop landed.

   Colour is "red and dead": every star is old, so no blue and no hot orange
   either. The tier before is a blue spiral this has to read differently from
   at a glance, and the tier after is a cluster of separate blobs, which is why
   the globulars stay tiny, tight, and subordinate to one obvious body. */
const ELL_SHELLS = [
  [1.40, '#64421e', 0.13], [1.24, '#6f4a22', 0.14], [1.09, '#7b5427', 0.15],
  [0.95, '#885e2c', 0.17], [0.82, '#986a33', 0.18], [0.70, '#a9793c', 0.20],
  [0.59, '#bb8a47', 0.22], [0.49, '#cc9d57', 0.25], [0.40, '#dcb06c', 0.28],
  [0.32, '#e9c286', 0.32], [0.25, '#f3d5a4', 0.37], [0.19, '#fae5c4', 0.44],
  [0.14, '#fdf1de', 0.52],
];
const ELL_Q = 0.68;
const ELL_GLOBS = (() => {
  let seed = 77123;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = [], spread = 0.46;
  for (let i = 0; i < 46; i++) {
    const th = rnd() * 2 * Math.PI;
    // globulars trace the halo, and the halo is centrally peaked, so they
    // concentrate inward rather than filling the box evenly
    const rr = Math.pow(rnd(), 0.55) * spread;
    out.push({
      x: 50 + rr * 100 * Math.cos(th), y: 50 + rr * 100 * Math.sin(th) * ELL_Q,
      t: rr / spread, s: 0.5 + rnd() * 0.8, w: rnd() < 0.22,
    });
  }
  return out;
})();

/* ---------- gas giant ----------
   Bands are drawn as wide ellipses rather than a striped gradient. A circle of
   latitude projects to an arc that is flat at the equator and bows harder
   towards the poles, so each band is an ellipse whose width shrinks and whose
   bow deepens with distance from the middle, clipped by the sphere. Straight
   stripes sit on the disc like paint, which is exactly the flatness the brown
   dwarf was redrawn to escape.

   Widths are deliberately uneven. Jupiter's zones and belts are nothing like a
   set of equal lanes, and equal ones read as a flag rather than a weather
   system. [lat (-1 south to 1 north), thickness, colour, opacity] */
const GAS_BANDS = [
  [0.93, 0.11, '#8a5526', 0.85],    // north polar hood, brown and dim
  [0.80, 0.06, '#f3dca8', 0.80],
  [0.69, 0.09, '#a85f22', 0.92],
  [0.56, 0.13, '#ffeec4', 0.95],
  [0.41, 0.07, '#b96c26', 0.90],
  [0.30, 0.06, '#f7e2b2', 0.85],
  [0.19, 0.10, '#9c5119', 0.95],    // north equatorial belt, the darkest
  [0.04, 0.16, '#fff5d8', 1.00],    // equatorial zone, the brightest
  [-0.14, 0.11, '#a4561c', 0.95],   // south equatorial belt
  [-0.31, 0.08, '#f3ddaa', 0.85],
  [-0.44, 0.12, '#b2681f', 0.92],   // the belt the Red Spot rides in
  [-0.60, 0.07, '#edd6a0', 0.80],
  [-0.72, 0.09, '#9a5a22', 0.85],
  [-0.88, 0.12, '#7d4d24', 0.85],   // south polar hood
];
/* eddies along the band edges, so the boundaries are not clean lines */
const GAS_EDDIES = [
  [58, 28, 16, 6, '#fff3d4', 0.5, 3], [12, 44, 13, 5, '#8a5020', 0.45, 3],
  [66, 52, 18, 5, '#fff0cc', 0.4, 3.5], [38, 20, 12, 5, '#a86428', 0.4, 3],
  [72, 74, 14, 5, '#f6dfa4', 0.35, 3],
];
/* the Galilean moons: what a Jupiter has instead of rings. Strung along one
   tilted plane so they read as a system rather than as stray pixels. */
const GAS_MOONS = [
  [3.5, 61, 0.040, '#fde68a'], [16, 74, 0.028, '#cbb894'],
  [96.5, 35, 0.035, '#f1dcae'], [84, 23, 0.026, '#e8d7b4'],
];

/* Old stars in the bulge are yellow, young ones out in the arms are blue. That
   one colour gradient is the most recognisable thing about a spiral galaxy --
   it does more work here than any amount of added detail. */
const starTint = (t) => (t < 0.20 ? '#fff1cd' : t < 0.42 ? '#f0f2ff' : t < 0.70 ? '#cddcff' : '#a5c4ff');
const laneTint = (t) => (t < 0.25 ? '#ffe6b0' : t < 0.55 ? '#cfd8f5' : '#9dbcf0');

/* Body draws ~180 nodes for the galaxy and the game loop re-renders about
   12 times a second. Both props are stable between stage changes, so memo
   reconciles this once per stage instead of once per frame. */
const Body = memo(function Body({ tier, size }) {
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

  /* A dwarf planet is drawn as a binary, because that is the interesting thing
     about a Pluto-class body: Charon is big enough that the pair turns about a
     barycentre out in the open between them rather than a point inside the
     primary. Both hang off one slow rotation about that empty centre. Charon's
     greys are literal rather than from tier.c, which only carries two colours
     and both of those belong to the primary. */
  if (tier.k === 'dwarf') {
    // The rotation centre is the barycentre, so the primary's offset has to
    // exceed its own radius or the pair is just a planet with a close moon.
    // pl/2 = 0.20 size against a 0.25 size offset puts it a quarter of a radius
    // clear of Pluto's surface, which is about where the real one sits.
    const pl = size * 0.40, ch = size * 0.21;
    // limb darkening: lit from the upper left, falling to shadow at the edge
    const shade = (x, y, lit) =>
      `radial-gradient(circle at ${x}% ${y}%, transparent ${lit}%, rgba(8,4,2,.6) 92%)`;
    return (
      <div className="ac-body" style={s}>
        <div className="ac-slowspin" style={{ position: 'absolute', inset: 0 }}>
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: pl, height: pl,
            margin: `${-pl / 2}px 0 0 ${-pl / 2}px`, transform: `translateX(${-size * 0.25}px)`,
            borderRadius: '50%', overflow: 'hidden',
            background: `radial-gradient(circle at 34% 28%, ${a}, ${b} 80%)`,
            boxShadow: `0 0 ${size * 0.18}px ${b}66`,
          }}>
            <div style={{
              position: 'absolute', left: '20%', top: '54%', width: '52%', height: '24%',
              borderRadius: '50%', background: '#3d241344', filter: 'blur(4px)',
            }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: shade(33, 27, 36) }} />
          </div>
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: ch, height: ch,
            margin: `${-ch / 2}px 0 0 ${-ch / 2}px`, transform: `translateX(${size * 0.375}px)`,
            borderRadius: '50%', overflow: 'hidden',
            background: 'radial-gradient(circle at 36% 30%, #d3dae1, #474d55 82%)',
            boxShadow: `0 0 ${size * 0.09}px #474d5588`,
          }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: shade(35, 29, 32) }} />
          </div>
        </div>
      </div>
    );
  }

  /* A world with air. The giveaway is the bright limb: the airglow ring has to
     sit OUTSIDE the disc, so its gradient stops are measured against an element
     wider than the sphere — inside it, the ring hides behind the planet and you
     get nothing. Land is several overlapping irregular blobs per mass in varied
     tints, because single ovals read as polka dots. */
  if (tier.k === 'world') {
    const sph = size * 0.8;
    const land = [
      [10, 26, 30, 22, '62% 38% 47% 53% / 55% 61% 39% 45%', b, 1, -12],
      [20, 38, 22, 17, '44% 56% 63% 37% / 51% 42% 58% 49%', '#3f6212', 0.9, 8],
      [26, 20, 16, 12, '55% 45% 40% 60% / 60% 45% 55% 40%', '#0f766e', 0.85, 20],
      [46, 14, 26, 19, '48% 52% 58% 42% / 62% 38% 62% 38%', b, 0.95, 14],
      [60, 24, 15, 13, '60% 40% 52% 48% / 44% 56% 44% 56%', '#3f6212', 0.8, -18],
      [52, 48, 30, 26, '57% 43% 38% 62% / 44% 58% 42% 56%', b, 1, 6],
      [62, 62, 17, 14, '46% 54% 60% 40% / 58% 42% 55% 45%', '#0f766e', 0.9, -10],
      [16, 62, 24, 19, '52% 48% 44% 56% / 61% 39% 57% 43%', b, 0.92, 16],
      [30, 72, 14, 11, '58% 42% 50% 50% / 45% 55% 48% 52%', '#3f6212', 0.75, -6],
    ];
    const cap = (edge, h, o) => ({
      position: 'absolute', left: '-6%', [edge]: `-${edge === 'top' ? 8 : 9}%`,
      width: '112%', height: `${h}%`, borderRadius: '50%',
      background: '#f8fdff', opacity: o, filter: `blur(${edge === 'top' ? 3 : 3.5}px)`,
    });
    return (
      <div className="ac-body" style={s}>
        <div style={{
          position: 'absolute', width: sph * 1.30, height: sph * 1.30, borderRadius: '50%',
          background: `radial-gradient(circle, transparent 74%, ${a}66 80%, ${a}22 86%, transparent 94%)`,
          filter: 'blur(1.5px)',
        }} />
        <div style={{
          position: 'relative', width: sph, height: sph, borderRadius: '50%', overflow: 'hidden',
          background: `radial-gradient(circle at 32% 26%, ${a}, #0284c7 46%, #083c5e 94%)`,
        }}>
          {land.map(([l, t, w, h, r, col, op, rot], i) => (
            <div key={i} style={{
              position: 'absolute', left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`,
              background: col, borderRadius: r, transform: `rotate(${rot}deg)`,
              filter: 'blur(1.6px)', opacity: op,
            }} />
          ))}
          <div style={cap('top', 14, 0.8)} />
          <div style={cap('bottom', 15, 0.72)} />
          <div className="ac-slowspin" style={{ position: 'absolute', left: '-25%', top: '-25%', width: '150%', height: '150%' }}>
            {[[16, 35, 54, 10, 0.4, 4], [38, 57, 38, 8, 0.32, 4], [45, 23, 24, 6, 0.28, 3]].map(([l, t, w, h, o, bl], i) => (
              <div key={i} style={{
                position: 'absolute', left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`,
                borderRadius: '50%', background: '#fff', opacity: o, filter: `blur(${bl}px)`,
              }} />
            ))}
          </div>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at 31% 25%, transparent 46%, rgba(1,6,20,.55) 100%)',
          }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: `inset 0 0 ${sph * 0.07}px ${a}bb` }} />
        </div>
      </div>
    );
  }

  /* Neptune-class: banded, but softly — bold stripes are the gas giant's job,
     and these two sit two stages apart. The Great Dark Spot and the methane
     cloud streaks are what carry it. */
  if (tier.k === 'ice') {
    const sph = size * 0.8;
    return (
      <div className="ac-body" style={s}>
        <div style={{
          position: 'absolute', width: sph * 1.28, height: sph * 1.28, borderRadius: '50%',
          background: `radial-gradient(circle, transparent 74%, ${a}4d 80%, ${a}1a 87%, transparent 94%)`,
          filter: 'blur(1.5px)',
        }} />
        <div style={{
          position: 'relative', width: sph, height: sph, borderRadius: '50%', overflow: 'hidden',
          background: `radial-gradient(circle at 34% 26%, #38bdf8, ${b} 62%, #062f4f 92%)`,
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'repeating-linear-gradient(176deg, #ffffff0c 0 10%, transparent 10% 17%, #04263f1c 17% 26%)',
          }} />
          <div style={{
            position: 'absolute', left: '16%', top: '30%', width: '34%', height: '20%', borderRadius: '50%',
            background: '#03203a', opacity: 0.72, filter: 'blur(2.5px)',
          }} />
          <div style={{
            position: 'absolute', left: '22%', top: '34%', width: '20%', height: '10%', borderRadius: '50%',
            background: '#01162b', opacity: 0.6, filter: 'blur(2px)',
          }} />
          {[[44, 56, 48, 6, 0.32], [22, 69, 34, 5, 0.22], [54, 25, 30, 4, 0.26]].map(([l, t, w, h, o], i) => (
            <div key={i} style={{
              position: 'absolute', left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`,
              borderRadius: '50%', background: '#eaf8ff', opacity: o, filter: 'blur(3.5px)',
            }} />
          ))}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at 33% 25%, transparent 46%, rgba(1,10,24,.58) 100%)',
          }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: `inset 0 0 ${sph * 0.09}px ${a}aa` }} />
        </div>
      </div>
    );
  }

  /* A failed star, and the one body on the ladder that is lit from inside.
     Every planet here uses a gradient offset to the upper left, which is what
     being lit from outside looks like; centring it and putting the brightest
     point in the middle is what says this thing glows by itself. Over that go
     broken iron and silicate cloud bands with the hot interior showing through
     the gaps, a few soft dark patches so the banding is not pure horizontal
     stripes, and a dull heat corona where a planet would wear a ring. */
  if (tier.k === 'ember') {
    const sph = size * 0.8;
    const dark = '#2a0f06';
    // uneven bands with uneven gaps; the alpha varies so no two cloud decks
    // sit at the same depth
    const band = `${dark}e6 0 6%, transparent 6% 11%, ${dark}c4 11% 15%, transparent 15% 22%, `
      + `${dark}ee 22% 28%, transparent 28% 33%, ${dark}b0 33% 37%, transparent 37% 45%, `
      + `${dark}dd 45% 51%, transparent 51% 56%, ${dark}cc 56% 61%, transparent 61% 69%, `
      + `${dark}e6 69% 75%, transparent 75% 80%, ${dark}bb 80% 85%, transparent 85% 93%, `
      + `${dark}d8 93% 100%`;
    return (
      <div className="ac-body" style={s}>
        <div className="ac-corona" style={{
          width: size * 1.06, height: size * 1.06,
          background: `radial-gradient(circle, ${a}20 40%, ${b}30 56%, transparent 72%)`,
        }} />
        <div style={{
          position: 'relative', width: sph, height: sph, borderRadius: '50%', overflow: 'hidden',
          background: `radial-gradient(circle at 50% 50%, #ffe6bd 0%, ${a} 20%, #c2410c 42%, ${b} 68%, #3b1508 100%)`,
        }}>
          {[[20, 30, 30, 13, 0.55, 5], [52, 58, 34, 14, 0.44, 5.5], [38, 16, 22, 9, 0.33, 4.5]].map(
            ([l, t, w, h, o, bl], i) => (
              <div key={`h${i}`} style={{
                position: 'absolute', left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`,
                borderRadius: '50%', opacity: o, filter: `blur(${bl}px)`,
                background: `radial-gradient(circle, #ffd9a0, ${a} 58%, transparent 80%)`,
              }} />
            ))}
          <div style={{
            position: 'absolute', inset: '-4%', filter: 'blur(3.2px)',
            background: `repeating-linear-gradient(174deg, ${band})`,
          }} />
          {[[-6, 22, 38, 22, 0.5, 7], [62, 44, 42, 26, 0.42, 8], [28, 74, 34, 20, 0.36, 7]].map(
            ([l, t, w, h, o, bl], i) => (
              <div key={`m${i}`} style={{
                position: 'absolute', left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`,
                borderRadius: '50%', background: dark, opacity: o, filter: `blur(${bl}px)`,
              }} />
            ))}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 50%, transparent 64%, rgba(12,3,0,.5) 100%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            boxShadow: `inset 0 0 ${sph * 0.05}px ${a}99, 0 0 ${sph * 0.05}px #00000088`,
          }} />
        </div>
      </div>
    );
  }

  /* Gas giant. Brown dwarf used to share this branch and no longer does, so
     this is the only tier drawing bands and a ring. */
  if (tier.k === 'gas') {
    const sph = size * 0.82, H = sph * 0.93;   // gas giants are visibly flattened
    return (
      <div className="ac-body" style={s}>
        <div style={{
          position: 'relative', width: sph, height: H, borderRadius: '50%', overflow: 'hidden',
          boxShadow: `0 0 ${size * 0.26}px ${b}55`, background: '#b9772f',
        }}>
          {GAS_BANDS.map(([lat, th, col, op], i) => {
            // a latitude circle projects to a chord of width cos(lat); the
            // ellipse carrying it must overhang the sphere or its own ends
            // curl into view
            const w = sph * (1.15 + 0.85 * Math.sqrt(Math.max(0, 1 - lat * lat)));
            const h = H * th * 2.1;
            const bow = H * 0.42 * lat * lat * Math.sign(lat);
            return (
              <div key={`b${i}`} style={{
                position: 'absolute', left: '50%', top: H * (0.5 - lat * 0.46) - h / 2 - bow * 0.5,
                width: w, height: h, marginLeft: -w / 2, borderRadius: '50%', opacity: op,
                background: `radial-gradient(ellipse at 50% 50%, ${col} 0%, ${col} 58%, ${col}00 100%)`,
              }} />
            );
          })}
          {/* the Great Red Spot, with the pale collar where the belt is
              dragged around it */}
          <div style={{
            position: 'absolute', left: '20%', top: '60.5%', width: '38%', height: '19%',
            borderRadius: '50%', transform: 'rotate(-7deg)', filter: `blur(${sph * 0.022}px)`,
            background: 'radial-gradient(ellipse at 42% 40%, #ffeaba 0%, #ffeaba55 52%, transparent 76%)',
          }} />
          <div style={{
            position: 'absolute', left: '23%', top: '63.5%', width: '32%', height: '13%',
            borderRadius: '50%', transform: 'rotate(-7deg)', filter: `blur(${sph * 0.008}px)`,
            background: 'radial-gradient(ellipse at 38% 34%, #f0915c 0%, #cf5426 42%, #94330f 78%, #6f2409 100%)',
          }} />
          {GAS_EDDIES.map(([l, t, w, h, c, o, bl], i) => (
            <div key={`e${i}`} style={{
              position: 'absolute', left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`,
              borderRadius: '50%', background: c, opacity: o, filter: `blur(${bl}px)`,
            }} />
          ))}
          {/* limb darkening and the lit side, on the same upper-left sun the
              other planets use */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at 34% 28%, #fff6dd33 0%, transparent 42%), '
              + 'radial-gradient(circle at 50% 50%, transparent 52%, #3a1e0866 80%, #24120499 100%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            boxShadow: `inset ${-sph * 0.10}px ${-sph * 0.06}px ${sph * 0.20}px rgba(28,12,2,.7)`,
          }} />
        </div>
        {GAS_MOONS.map(([x, y, d, c], i) => (
          <div key={`m${i}`} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`, width: size * d, height: size * d,
            margin: `${-size * d / 2}px 0 0 ${-size * d / 2}px`, borderRadius: '50%', background: c,
            boxShadow: `0 0 ${size * 0.02}px ${a}88`,
          }} />
        ))}
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

  /* Six tiers share this one. What actually separates a stellar-mass hole from
     a quasar is not the hole, it is what surrounds it — a companion star being
     stripped, a star cluster, cold gas, orbiting S-stars, jets — so those live
     in tier.h rather than in six near-identical branches. Layering matters:
     disk 1, feed 1, jets 2, photon ring 3, horizon 4. Without an explicit
     z-index the disk paints last and swallows the jets. */
  if (tier.k === 'hole') {
    const {
      r = 0.56, disk = 1, dh = 0.42, diskOp = 0.92, spin = 3.4,
      jet = 0, ring = 0, glow = 1, feed = null,
    } = tier.h || {};
    const hz = size * r;
    const dot = (x, y, sc, i) => (
      <div key={`c${i}`} style={{
        position: 'absolute', left: `${x}%`, top: `${y}%`,
        width: size * 0.052 * sc, height: size * 0.052 * sc, borderRadius: '50%',
        background: '#fff', opacity: 0.35 + sc * 0.5, boxShadow: `0 0 ${size * 0.03}px ${a}`, zIndex: 1,
      }} />
    );
    return (
      <div className="ac-body" style={s}>
        {disk && !jet ? (
          <div className="ac-disk" style={{
            width: size * 1.35 * disk, height: size * dh * disk, opacity: diskOp,
            animationDuration: `${spin}s`, zIndex: 1,
            background: `conic-gradient(from 0deg, ${b}, ${a}, #fff, ${a}, ${b}, ${a}, #fff, ${b})`,
          }} />
        ) : null}

        {/* A jetted hole is drawn as one system. The beams track the spin axis,
            so they and the disk share a single rotating frame — spun apart, the
            disk sweeps through vertical every few seconds and swallows them.
            Real jets are beaded rather than smooth, so each beam gets a
            collimated white core, shock knots down its length, a faint
            ionisation cone and a terminal lobe where it stops. */}
        {jet ? (
          <div className="ac-slowspin" style={{
            position: 'absolute', inset: 0, animationDuration: `${spin}s`,
          }}>
            {['bottom', 'top'].map((edge) => {
              const dir = edge === 'bottom' ? 'to top' : 'to bottom';
              const jw = size * 0.15 * jet, jh = size * 0.92 * jet;
              const at = (f) => `calc(50% + ${jh * f}px)`;
              const lw = size * 0.30;
              return (
                <div key={edge}>
                  <div style={{
                    position: 'absolute', left: '50%', [edge]: '50%',
                    width: size * 0.52, height: jh * 0.86, marginLeft: -size * 0.26,
                    background: `linear-gradient(${dir}, ${a}1c, ${a}0a 46%, transparent 86%)`,
                    clipPath: 'polygon(50% 100%, 100% 0%, 0% 0%)',
                    transform: edge === 'bottom' ? 'rotate(180deg)' : undefined,
                    filter: `blur(${size * 0.05}px)`, opacity: 0.7, zIndex: 1,
                  }} />
                  <div style={{
                    position: 'absolute', left: '50%', [edge]: '50%', width: jw, height: jh,
                    marginLeft: -jw / 2, filter: `blur(${size * 0.020}px)`, opacity: 0.95, zIndex: 2,
                    background: `linear-gradient(${dir}, #ffffff, #f0abfc 14%, #c026d3 40%, #86198f 68%, ${b}44 88%, transparent 100%)`,
                  }} />
                  <div style={{
                    position: 'absolute', left: '50%', [edge]: '50%', width: jw * 0.22, height: jh * 0.94,
                    marginLeft: -jw * 0.11, filter: `blur(${size * 0.0035}px)`, zIndex: 4,
                    background: `linear-gradient(${dir}, #fff, #fff 26%, #fbcfe8 52%, ${a}66 78%, transparent 100%)`,
                  }} />
                  {[[0.26, 1, 1], [0.44, 0.8, 0.9], [0.62, 0.6, 0.75], [0.79, 0.45, 0.55]].map(([f, sc, op], i) => {
                    const d = size * 0.085 * sc;
                    return (
                      <div key={`k${i}`} style={{
                        position: 'absolute', left: '50%', [edge]: at(f),
                        width: d, height: d * 0.66, marginLeft: -d / 2, borderRadius: '50%',
                        background: `radial-gradient(circle, #ffffff 18%, #f0abfc 52%, ${a}00 80%)`,
                        filter: `blur(${size * 0.010}px)`, opacity: op, zIndex: 4,
                      }} />
                    );
                  })}
                  <div style={{
                    position: 'absolute', left: '50%', [edge]: at(0.92),
                    width: lw, height: lw * 0.56, marginLeft: -lw / 2, borderRadius: '50%',
                    background: 'radial-gradient(ellipse, #f5d0fecc, #c026d366 44%, transparent 72%)',
                    filter: `blur(${size * 0.028}px)`, opacity: 0.8, zIndex: 2,
                  }} />
                </div>
              );
            })}
            <div className="ac-disk" style={{
              position: 'absolute', left: '50%', top: '50%',
              width: size * 1.35 * disk, height: size * dh * disk,
              margin: `${-size * dh * disk / 2}px 0 0 ${-size * 1.35 * disk / 2}px`,
              animation: 'none', opacity: diskOp, zIndex: 3, filter: `blur(${size * 0.013}px)`,
              background: `conic-gradient(from 0deg, ${b}, #86198f, #c026d3, #f0abfc, #ffffff, #f0abfc, `
                + `#a21caf, ${b}, #86198f, #c026d3, #ffffff, #e879f9, #a21caf, ${b})`,
            }} />
          </div>
        ) : null}

        {feed === 'companion' && (<>
          <div style={{
            position: 'absolute', left: '2%', top: '22%', width: size * 0.50, height: size * 0.40,
            borderRadius: '50%', border: `${size * 0.030}px solid transparent`,
            borderTopColor: '#dbeafe', borderRightColor: '#93c5fd',
            transform: 'rotate(22deg)', filter: `blur(${size * 0.012}px)`, opacity: 0.75, zIndex: 1,
          }} />
          <div style={{
            position: 'absolute', left: '4%', top: '24%', width: size * 0.22, height: size * 0.22,
            borderRadius: '50%', zIndex: 3,
            background: 'radial-gradient(circle at 38% 34%, #fff 14%, #dbeafe 42%, #60a5fa 82%)',
            boxShadow: `0 0 ${size * 0.16}px #93c5fd, 0 0 ${size * 0.05}px #fff`,
          }} />
        </>)}

        {feed === 'cluster' && [[14, 20, 0.55], [82, 26, 0.7], [26, 78, 0.5], [72, 74, 0.6], [6, 54, 0.4],
          [92, 58, 0.45], [44, 8, 0.5], [58, 92, 0.4], [34, 40, 0.3], [66, 40, 0.35]]
          .map(([x, y, sc], i) => dot(x, y, sc, i))}

        {feed === 'dust' && [[-18, 14, 86, 44, 0.5, -16], [28, 58, 82, 40, 0.42, 12],
          [6, -10, 66, 34, 0.3, 8], [46, 20, 58, 30, 0.26, -6]].map(([x, y, w, hh, o, rot], i) => (
          <div key={`d${i}`} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%`,
            borderRadius: '50%', opacity: o, transform: `rotate(${rot}deg)`,
            filter: `blur(${size * 0.05}px)`, zIndex: 1,
            background: 'radial-gradient(ellipse, #8d5340, #43203a 55%, transparent 76%)',
          }} />
        ))}

        {feed === 'orbits' && [[1.16, 0.52, -22, 26, '#fff'], [0.92, 0.38, 34, 18, '#fde68a'],
          [1.32, 0.30, 8, 34, '#bfdbfe']].map(([w, hh, rot, dur, col], i) => (
          <div key={`o${i}`} className="ac-slowspin" style={{
            position: 'absolute', width: size * w, height: size * hh,
            animationDuration: `${dur}s`, transform: `rotate(${rot}deg)`, zIndex: 1,
          }}>
            <div style={{ position: 'absolute', inset: 0, border: `1px solid ${a}55`, borderRadius: '50%' }} />
            <div style={{
              position: 'absolute', left: 0, top: '50%', width: size * 0.03, height: size * 0.03,
              marginTop: -size * 0.015, borderRadius: '50%', background: col,
              boxShadow: `0 0 ${size * 0.05}px ${col}`,
            }} />
          </div>
        ))}

        {ring ? (
          <div style={{
            position: 'absolute', width: hz * 1.16, height: hz * 1.16, borderRadius: '50%', zIndex: 3,
            border: `${Math.max(1.2, size * 0.008 * ring)}px solid #ffffff${ring > 0.8 ? '' : 'aa'}`,
            boxShadow: `0 0 ${size * 0.05 * ring}px #fff, inset 0 0 ${size * 0.04 * ring}px #fff`,
            opacity: Math.min(0.95, 0.45 + ring * 0.4),
          }} />
        ) : null}

        <div style={{
          width: hz, height: hz, borderRadius: '50%', background: '#000', zIndex: 4,
          boxShadow: `0 0 0 2px ${a}, 0 0 ${size * 0.22 * glow}px ${a}cc, 0 0 ${size * 0.7 * glow}px ${b}`,
        }} />
      </div>
    );
  }

  if (tier.k === 'galaxy') {
    const flat = 0.55, tilt = -20;
    return (
      <div className="ac-body" style={s}>
        <div style={{
          position: 'absolute', width: size * 1.2, height: size * 1.2 * flat,
          transform: `rotate(${tilt}deg)`, borderRadius: '50%',
          background: `radial-gradient(${a}18 34%, ${b}2e 58%, transparent 76%)`,
        }} />
        {/* the disk plane: the geometry is built face-on, this projects it */}
        <div style={{
          position: 'absolute', width: size, height: size,
          transform: `rotate(${tilt}deg) scaleY(${flat})`,
        }}>
          <div className="ac-slowspin" style={{ position: 'absolute', inset: 0, animationDuration: '38s' }}>
            <div style={{
              position: 'absolute', left: '50%', top: '50%', width: size * 0.96, height: size * 0.96,
              margin: `${-size * 0.48}px 0 0 ${-size * 0.48}px`, borderRadius: '50%',
              background: 'radial-gradient(#e2ebff26 10%, #3c62b81a 44%, transparent 70%)',
            }} />
            {GALAXY.lane.map((p, i) => {
              const w = size * p.len, h = size * p.wid, c = laneTint(p.t);
              return (
                <div key={`l${i}`} style={{
                  position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, width: w, height: h,
                  margin: `${-h / 2}px 0 0 ${-w / 2}px`, transform: `rotate(${p.rot}deg)`,
                  borderRadius: '50%', opacity: (0.66 - p.t * 0.22) * (1 - Math.pow(p.f, 2.4) * 0.72),
                  background: `radial-gradient(${c}dd 0%, ${c}66 45%, ${c}00 76%)`,
                }} />
              );
            })}
            {GALAXY.stars.map((p, i) => {
              const d = size * (p.hii ? 0.028 : 0.015) * p.s, c = p.hii ? '#f9a8d4' : starTint(p.t);
              return (
                <div key={`s${i}`} style={{
                  /* pre-stretched so the parent's scaleY lands it round: a star
                     is a point, its glow should not lie in the disk plane */
                  position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, width: d, height: d / flat,
                  margin: `${-d / flat / 2}px 0 0 ${-d / 2}px`,
                  opacity: p.faint ? 0.25 + p.s * 0.3 : p.hii ? 0.85 : 0.5 + (1 - p.t) * 0.42,
                  background: `radial-gradient(${c} 0%, ${c}bb 32%, ${c}00 70%)`,
                }} />
              );
            })}
            {/* the bar. The Milky Way has one, and it seats the inner arms */}
            <div style={{
              position: 'absolute', left: '50%', top: '50%', width: size * 0.26, height: size * 0.135,
              margin: `${-size * 0.0675}px 0 0 ${-size * 0.13}px`, borderRadius: '50%',
              transform: 'rotate(-28deg)',
              background: 'radial-gradient(#ffeec2aa 10%, #ffdd9955 46%, transparent 74%)',
            }} />
          </div>
        </div>
        <div style={{
          position: 'absolute', width: size * 0.14, height: size * 0.14 * flat * 1.45,
          borderRadius: '50%', transform: `rotate(${tilt}deg)`,
          background: 'radial-gradient(#ffffff 18%, #fff4d2 44%, #ffd98a55 66%, transparent 80%)',
          boxShadow: `0 0 ${size * 0.13}px #ffeec288, 0 0 ${size * 0.3}px #9dbcf044`,
        }} />
      </div>
    );
  }

  if (tier.k === 'elliptical') {
    const tilt = -14, q = ELL_Q;
    return (
      <div className="ac-body" style={s}>
        <div style={{
          position: 'absolute', width: size * 1.42, height: size * 1.42 * q,
          borderRadius: '50%', transform: `rotate(${tilt}deg)`,
          background: 'radial-gradient(#c8934c10 0%, #6b431c0c 46%, transparent 72%)',
        }} />
        {ELL_SHELLS.map(([d, c, op], i) => (
          <div key={`e${i}`} style={{
            position: 'absolute', width: size * d, height: size * d * q,
            borderRadius: '50%', opacity: op, transform: `rotate(${tilt}deg)`,
            background: `radial-gradient(${c}, transparent 74%)`,
          }} />
        ))}
        <div className="ac-slowspin" style={{
          position: 'absolute', inset: 0, animationDuration: '70s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {ELL_GLOBS.map((g, i) => {
            const d = Math.max(1, size * 0.0095 * g.s), c = g.w ? '#fff6e2' : '#ffdb9a';
            return (
              <div key={`g${i}`} style={{
                position: 'absolute', left: `${g.x}%`, top: `${g.y}%`, width: d, height: d,
                margin: `${-d / 2}px 0 0 ${-d / 2}px`, borderRadius: '50%', background: c,
                opacity: 0.9 - g.t * 0.45, boxShadow: `0 0 ${d * 1.7}px ${c}66`,
              }} />
            );
          })}
          {/* two companions part-way through being eaten. IC 1101 is a
              cluster-dominant cannibal, and this is the one kind of structure
              an elliptical really does show. */}
        </div>
        {[[24, 31, 0.075, 0.38, -34], [76, 70, 0.055, 0.28, 14]].map(([x, y, w, op, rot], i) => (
          <div key={`c${i}`} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`,
            width: size * w, height: size * w * 0.55,
            margin: `${-size * w * 0.275}px 0 0 ${-size * w / 2}px`, borderRadius: '50%',
            opacity: op, transform: `rotate(${rot}deg)`,
            background: 'radial-gradient(#ffeccb 0%, #c9924a 44%, transparent 76%)',
          }} />
        ))}
        <div style={{
          position: 'absolute', width: size * 0.11, height: size * 0.11 * 0.82,
          borderRadius: '50%', transform: `rotate(${tilt}deg)`,
          background: 'radial-gradient(#ffffff 20%, #fff7e2 46%, #ffe0a033 70%, transparent 86%)',
          boxShadow: `0 0 ${size * 0.12}px #ffeaba88, 0 0 ${size * 0.3}px #a0682c55`,
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
});

/* `ok` says whether the row can be pressed; `lit` says whether it looks live.
   They are the same thing for every row but a paused Self-assembly, which has
   to stay pressable (that is how you resume it) while reading as switched off. */
function Row({ title, sub, cost, right, ok, onClick, accent, note, tint, lit = ok }) {
  const c = tint || accent;
  return (
    <button className="ac-row" onClick={onClick} disabled={!ok}
      style={{
        borderColor: lit ? `${c}66` : 'rgba(255,255,255,.07)',
        background: lit
          ? `linear-gradient(100deg, ${c}22, rgba(255,255,255,.04) 55%)`
          : 'rgba(255,255,255,.03)',
      }}>
      <div className="ac-bead" style={{ background: c, boxShadow: lit ? `0 0 9px ${c}cc` : 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ac-row-t">
          <span>{title}</span>
          {right ? <span style={{ color: c }}>{right}</span> : null}
        </div>
        <div className="ac-row-s">{sub}</div>
        <div className="ac-row-c" style={{ color: lit ? c : '#5b6b87' }}>
          {cost}{note ? <span className="ac-note">{note}</span> : null}
        </div>
      </div>
    </button>
  );
}

export default function Accretion() {
  const G = useRef(newGame());
  const ready = useRef(false);
  const [, render] = useState(0);
  const [tab, setTab] = useState('gen');
  /* Each tab renders its own .ac-list, so switching unmounts one scroller and
     mounts another at the top. Remember where each tab was left. The game loop
     re-renders ~12x a second but does not remount the list, so scrollTop
     survives those on its own; only a tab change needs restoring. */
  const listEl = useRef(null);
  const scrollPos = useRef({});
  useLayoutEffect(() => {
    if (listEl.current) listEl.current.scrollTop = scrollPos.current[tab] || 0;
  }, [tab]);
  const onListScroll = (e) => { scrollPos.current[tab] = e.currentTarget.scrollTop; };
  /* Tidal resonance fires a pull once a second. Kept as a ref accumulator so
     the cadence follows real elapsed time rather than the frame rate, and so
     firing one costs no re-render beyond the loop's own. */
  const autoPull = useRef(0);
  const flashTimer = useRef(null);
  const [amt, setAmt] = useState(1);
  const [pops, setPops] = useState([]);
  const [welcome, setWelcome] = useState(null);
  const [flash, setFlash] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [storageOk, setStorageOk] = useState(true);
  const [io, setIo] = useState(null);

  /* "Start over" arms on the first tap and erases on the second. It used to
     stay armed for the rest of the session, so leaving the tab and coming back
     much later left a single tap standing between the player and a wipe. */
  useEffect(() => { setWipe(false); }, [tab]);

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
          const offline = applyOffline(s);
          if (offline.dt > 60 && offline.gain > 0) setWelcome(offline);
          await window.storage.set(SAVE_KEY, JSON.stringify(s));
          setSavedAt(s.lastSave);
        }
      } catch (e) { /* first run, or no storage */ }
      // outside the try: a first run has no save to read, and that throws
      if (/[?&]dev\b/.test(location.search)) G.current.dev = true;
      ready.current = true;
      render((x) => x + 1);
    })();
  }, []);

  const save = useCallback(async () => {
    if (!ready.current) return false;
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
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 3200);
    }
  };

  useEffect(() => {
    let raf, last = performance.now(), painted = 0, saved = 0, bought = 0;
    const loop = (t) => {
      const dt = Math.min((t - last) / 1000, 1); last = t;
      if (!ready.current || document.hidden) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const s = G.current;
      s.mass += prod(s) * dt;
      s.played += dt;

      /* Tidal resonance: a pull a second, silently. The real thing plays a
         sound and throws a number up the screen; once a second forever that
         would be unbearable, so the automated one only moves mass. */
      if (s.perks[7]) {
        autoPull.current += dt;
        while (autoPull.current >= 1) { autoPull.current -= 1; s.mass += tapGain(s); s.taps++; }
      } else {
        autoPull.current = 0;
      }

      /* Bank the peak BEFORE Self-assembly gets to spend it. Stages are
         gated on best, and an autobuyer that spends on the same tick the
         threshold is crossed would hide that peak and stall the ladder. This
         is also the order the balance was simulated in, so the stage bonus
         lands first and is available to the purchase below. */
      if (s.mass > s.best) { s.best = s.mass; checkStage(s); }

      /* Self-assembly. Throttled to four times a second: the planner walks
         every accretor and the frame budget is better spent elsewhere, and the
         simulated run time is identical at 4Hz and 60Hz anyway. */
      if (s.perks[AUTO_PERK] && s.auto && t - bought > 250) {
        bought = t;
        const pick = autoPick(s);
        if (pick) { s.mass -= pick.c; s.gens[pick.i] += pick.n; }
      }

      if (t - painted > 80) { painted = t; render((x) => x + 1); }
      if (t - saved > 12000) { saved = t; save(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const bye = () => {
      if (!ready.current) return;
      if (!document.hidden) {
        const offline = applyOffline(G.current);
        if (offline.dt > 60 && offline.gain > 0) setWelcome(offline);
        last = performance.now();
        render((x) => x + 1);
      }
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
    const free = devFree(s);
    // "buy max" with free purchases would price off a mass you never spend,
    // so in dev it means a fixed block of levels instead
    const n = amt === -1 ? (free ? 25 : genMax(i, s.gens[i], s.mass)) : amt;
    if (n < 1) return;
    const c = free ? 0 : genCost(i, s.gens[i], n);
    if (c > s.mass) return;
    const before = Math.floor(s.gens[i] / BALANCE.milestoneEvery);
    s.mass -= c; s.gens[i] += n;
    Math.floor(s.gens[i] / BALANCE.milestoneEvery) > before ? SFX.milestone() : SFX.buy();
    render((x) => x + 1);
  };

  const buyTap = () => {
    const c = devFree(s) ? 0 : tapCost(s);
    if (tapMaxed(s) || c > s.mass) return;
    s.mass -= c; s.tap++;
    SFX.tapUp(s.tap);
    render((x) => x + 1);
  };

  const buyUp = (i) => {
    const c = devFree(s) ? 0 : UPGRADES[i].cost;
    if (s.ups[i] || c > s.mass) return;
    s.mass -= c; s.ups[i] = true;
    SFX.upgrade();
    render((x) => x + 1);
  };

  const collapse = () => {
    const got = shardsFrom(s.best);
    // shardsFrom reaches 1 at ~4e32 kg, thousands of times below the prestige
    // threshold, so the shard count alone is not the gate the UI implies
    if (s.stage < PRESTIGE_AT || got < 1) return;
    SFX.collapse();
    G.current = applyPerks({
      ...newGame(),
      shards: s.shards + got,
      shardsTotal: (s.shardsTotal || 0) + got,
      dens: s.dens,
      perks: s.perks.slice(),
      collapses: s.collapses + 1,
      taps: s.taps, played: s.played, sfx: s.sfx, hum: s.hum, dev: s.dev, auto: s.auto,
    });
    // Frozen physics keeps what you had, not a free five: hold three and you
    // carry three. applyPerks cannot do this, since only collapse() can see
    // both the old run and the new one.
    if (s.perks[4]) for (let i = 0; i < 5; i++) G.current.ups[i] = s.ups[i];
    SFX.humStage(0);
    scrollPos.current = {};
    setConfirm(false); setTab('gen'); save(); render((x) => x + 1);
  };

  const buyDens = () => {
    const c = devFree(s) ? 0 : densCost(s);
    if (c > s.shards) return;
    s.shards -= c;
    s.dens = (s.dens || 0) + 1;
    SFX.milestone();
    save(); render((x) => x + 1);
  };

  const buyPerk = (i) => {
    const c = devFree(s) ? 0 : PERKS[i].cost;
    if (s.perks[i] || c > s.shards) return;
    s.shards -= c;
    s.perks[i] = true;
    applyPerks(s);
    SFX.upgrade();
    save(); render((x) => x + 1);
  };

  /* Dev mode is off unless you ask for it: five taps on the play-time stat,
     or ?dev in the URL. Neither happens by accident during a normal run. */
  const devTaps = useRef(0);
  const nudgeDev = () => {
    devTaps.current += 1;
    if (devTaps.current < 5) return;
    devTaps.current = 0;
    setDev(!s.dev);
  };
  const setDev = (on) => {
    s.dev = on;
    SFX.upgrade();
    save(); render((x) => x + 1);
  };

  /* Test tools. Each one moves the real state the real way, so what you are
     looking at afterwards is a state the game could actually reach. */
  const devGrant = (mult) => {
    s.mass = Math.max(s.mass, ATOM) * mult;
    if (s.mass > s.best) { s.best = s.mass; checkStage(s); }
    SFX.buy(); render((x) => x + 1);
  };
  const devSkipStage = () => {
    const next = TIERS[s.stage + 1];
    if (!next) return;
    s.mass = Math.max(s.mass, next.at);
    s.best = s.mass; checkStage(s);
    render((x) => x + 1);
  };
  /* Run the production loop forward without waiting for it. This is the one
     that matters for pacing work: it answers "where am I an hour from now". */
  const devFastForward = (hours) => {
    s.mass += prod(s) * hours * 3600;
    s.played += hours * 3600;
    if (s.mass > s.best) { s.best = s.mass; checkStage(s); }
    SFX.milestone(); render((x) => x + 1);
  };
  const devShards = (n) => {
    s.shards += n; s.shardsTotal = (s.shardsTotal || 0) + n;
    SFX.buy(); render((x) => x + 1);
  };

  const toggleSfx = () => {
    SFX.unlock();
    s.sfx = !s.sfx;
    SFX.setOn(s.sfx);
    if (s.sfx) { SFX.click(); if (s.hum) SFX.hum(true, s.stage); }
    save(); render((x) => x + 1);
  };

  const toggleAuto = () => {
    s.auto = !s.auto;
    SFX.click();
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
      scrollPos.current = {};
      setIo(null); setTab('gen'); setWipe(false);
      save(); render((x) => x + 1);
    } catch (e) {
      setIo({ ...io, msg: "That code couldn't be read. Paste the whole thing, including the ACC6- prefix." });
    }
  };

  const size = Math.min(74 + s.stage * 2.7, 178);
  const visible = GENS.map((g, i) => i)
    .filter((i) => s.dev || i < 2 || s.best >= GENS[i].cost * 0.2 || s.gens[i] > 0);
  const openUps = UPGRADES.map((u, i) => i)
    .filter((i) => !s.ups[i] && (s.dev || s.best >= UPGRADES[i].cost * 0.15));

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
        .ac-corona{position:absolute;border-radius:50%;animation:breathe 4s ease-in-out infinite}
        @keyframes breathe{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.12);opacity:1}}
        .ac-disk{position:absolute;border-radius:50%;filter:blur(5px);opacity:.92;animation:spin 3.4s linear infinite;
          mask:radial-gradient(circle,transparent 26%,#000 34%);-webkit-mask:radial-gradient(circle,transparent 26%,#000 34%)}
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
            {s.dev && (
              <button className="on" onClick={() => setDev(false)} aria-label="Developer mode is on"
                style={{ color: '#fca5a5', borderColor: '#fca5a566', background: '#fca5a51f' }}>dev</button>
            )}
            {s.perks[AUTO_PERK] && (
              <button className={s.auto ? 'on' : ''} onClick={toggleAuto}
                aria-label={`Self-assembly is ${s.auto ? 'on' : 'off'}`} aria-pressed={s.auto}
                style={s.auto ? { color: SHARD_C, borderColor: `${SHARD_C}66`, background: `${SHARD_C}1f` } : undefined}>auto</button>
            )}
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
          <div className="ac-list" ref={listEl} onScroll={onListScroll}>
            {visible.map((i) => {
              const owned = s.gens[i];
              const free = devFree(s);
              const n = amt === -1 ? (free ? 25 : Math.max(genMax(i, owned, s.mass), 1)) : amt;
              const c = free ? 0 : genCost(i, owned, n);
              const toMs = BALANCE.milestoneEvery - (owned % BALANCE.milestoneEvery);
              const after = { ...s, gens: s.gens.map((count, j) => j === i ? count + n : count) };
              const addedOutput = (genOutput(after, i) - genOutput(s, i)) * upMult(s);
              return (
                <Row key={i} accent={accent} tint={GENS[i].c} ok={free || c <= s.mass} onClick={() => buyGen(i)}
                  title={GENS[i].n} sub={GENS[i].d} right={owned ? `${owned}` : ''}
                  cost={`${free ? 'free' : `${fmt(c)} kg`}${n > 1 ? ` · ${n}×` : ''}`}
                  note={`This purchase: +${fmt(addedOutput)} kg/s · Current: ${fmt(genOutput(s, i) * upMult(s))} kg/s · ×${GENS[i].m} milestone in ${toMs} levels`}
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
        <div className="ac-list" ref={listEl} onScroll={onListScroll}>
          <Row accent={accent} tint="#fcd34d" ok={!tapMaxed(s) && (devFree(s) || tapCost(s) <= s.mass)} onClick={buyTap}
            title="Capture cross-section"
            sub={tapMaxed(s)
              ? 'Every pull takes the widest bite it can'
              : `Each pull takes +${(BALANCE.tapStep * 100).toFixed(1)}% of a second's output`}
            right={`lv ${s.tap} / ${BALANCE.tapLevels}`}
            cost={tapMaxed(s) ? 'Maxed' : devFree(s) ? 'free' : `${fmt(tapCost(s))} kg`}
            note={`Per pull: ${fmt(tapGain(s))} kg · ${(tapShare(s) * 100).toFixed(1)}% of a second${
              tapMaxed(s) ? '' : ` → ${(tapShare({ ...s, tap: s.tap + 1 }) * 100).toFixed(1)}%`}`} />

          {openUps.map((i) => (
            <Row key={i} accent={accent} tint={UPGRADES[i].c} onClick={() => buyUp(i)}
              ok={devFree(s) || UPGRADES[i].cost <= s.mass}
              title={UPGRADES[i].n} sub={UPGRADES[i].d}
              cost={devFree(s) ? 'free' : `${fmt(UPGRADES[i].cost)} kg`}
              note={`×${UPGRADES[i].mult} accretor production · +${fmt(perSec * (UPGRADES[i].mult - 1))} kg/s · +${fmt(perSec * (UPGRADES[i].mult - 1) * tapShare(s))} kg/pull; base pull unchanged`} />
          ))}

          <div style={{ padding: '10px 11px', borderRadius: 12, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)' }}>
            <div className="ac-row-t" style={{ marginBottom: 3 }}>
              <span>Gravitational collapse</span>
              <span style={{ color: SHARD_C }}>{s.shards} shards</span>
            </div>
            <div className="ac-row-s">
              Once you are supermassive you can collapse back to hydrogen. Mass, accretors, and physics upgrades reset. You keep shards, purchased perks, and every level of density you have bought. Shards do nothing on their own — spend them below on density, which raises output for good, or on perks.
            </div>
            {s.stage >= PRESTIGE_AT ? (
              <button className="ac-btn" style={{ background: accent }} onClick={() => setConfirm(true)}>
                Collapse for {shardsFrom(s.best)} shards
              </button>
            ) : (
              <div className="ac-row-c" style={{ color: '#64748b' }}>Unlocks at {fmt(TIERS[PRESTIGE_AT].at)} kg</div>
            )}
          </div>

          {(s.dev || s.shardsTotal > 0) && (
            <>
              <div className="ac-sub" style={{ padding: '8px 2px 2px' }}>
                Spend shards · <span style={{ color: SHARD_C }}>{s.shards} to spend</span>
              </div>
              <Row accent={accent} tint={SHARD_C} onClick={buyDens}
                ok={devFree(s) || densCost(s) <= s.shards}
                title="Primordial density"
                sub="Collapse into a denser universe. Every level multiplies all output, and they compound."
                right={`lv ${s.dens || 0}`}
                cost={devFree(s) ? 'free' : `${densCost(s)} shards`}
                note={`Now ×${shardMult(s).toFixed(2)} output · next level ×${shardMult({ dens: (s.dens || 0) + 1 }).toFixed(2)}, so the run after it is ${Math.round((1 - 1 / BALANCE.densStep) * 100)}% shorter`} />
              {PERKS.map((p, i) => {
                /* An owned Self-assembly stays enabled so it can be switched
                   back on; every other owned perk is inert. */
                const pausable = s.perks[i] && i === AUTO_PERK;
                return (
                  <Row key={i} accent={accent} tint={SHARD_C}
                    onClick={() => (pausable ? toggleAuto() : buyPerk(i))}
                    ok={pausable || (!s.perks[i] && (devFree(s) || p.cost <= s.shards))}
                    lit={pausable ? s.auto : !s.perks[i] && (devFree(s) || p.cost <= s.shards)}
                    title={p.n} sub={p.d}
                    right={pausable ? (s.auto ? 'on' : 'paused') : s.perks[i] ? 'owned' : ''}
                    cost={pausable
                      ? (s.auto ? 'Buying for you · tap to pause' : 'Paused · tap to resume')
                      : s.perks[i] ? 'Active' : devFree(s) ? 'free' : `${p.cost} shards`} />
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === 'stat' && (
        <div className="ac-list" ref={listEl} onScroll={onListScroll}>
          {[
            ['Heaviest reached', `${fmt(s.best)} kg`],
            ['Stages passed', `${s.stage + 1} of ${TIERS.length}`],
            ['Output', `${fmt(perSec)} kg/s`],
            ['Output multiplier', `×${fmt(upMult(s))}`],
            ['Accretors owned', `${s.gens.reduce((a, b) => a + b, 0)}`],
            ['Pulls', `${s.taps}`],
            ['Collapses', `${s.collapses}`],
            ['Shards earned', `${s.shardsTotal || 0}`],
            [PLAY_STAT, dur(s.played)],
          ].map(([k, v]) => (
            <div key={k} onClick={k === PLAY_STAT ? nudgeDev : undefined}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 11px', fontSize: 12.5 }}>
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
            onClick={() => { if (wipe) { G.current = newGame(); SFX.hum(false); setWipe(false); scrollPos.current = {}; save(); } else setWipe(true); }}>
            {wipe ? 'Tap again to erase everything' : 'Start over'}
          </button>

          {s.dev && (
            <div style={{
              marginTop: 10, padding: '10px 11px', borderRadius: 12,
              background: 'rgba(252,165,165,.06)', border: '1px solid rgba(252,165,165,.28)',
            }}>
              <div className="ac-row-t" style={{ marginBottom: 3 }}>
                <span style={{ color: '#fca5a5' }}>Developer mode</span>
                <span style={{ color: '#fca5a5' }}>free</span>
              </div>
              <div className="ac-row-s" style={{ marginBottom: 8 }}>
                Accretors, physics, the pull track and perks all cost nothing, and
                nothing is hidden behind an unlock. Tap the play time five times
                again to leave.
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button className="ac-tab" onClick={() => devFastForward(1)}>+1 hour</button>
                <button className="ac-tab" onClick={() => devFastForward(8)}>+8 hours</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button className="ac-tab" onClick={devSkipStage}>Next stage</button>
                <button className="ac-tab" onClick={() => devGrant(1e6)}>×10⁶ mass</button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="ac-tab" onClick={() => devShards(25)}>+25 shards</button>
                <button className="ac-tab" onClick={() => setDev(false)}>Leave dev mode</button>
              </div>
            </div>
          )}
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
              {welcome.timeCapped ? ` Only the first ${offlineHours(s)} hours earned offline mass.` : ''}
              {welcome.massCapped ? ' Earnings reached the offline mass cap.' : ''}
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
              Everything returns to a single hydrogen atom. You keep density, perks, and {s.shards + shardsFrom(s.best)} shards
              — enough for {densLevelsFor(s, s.shards + shardsFrom(s.best))} more {densLevelsFor(s, s.shards + shardsFrom(s.best)) === 1 ? 'level' : 'levels'} of
              density, taking you to ×{shardMult({ dens: (s.dens || 0) + densLevelsFor(s, s.shards + shardsFrom(s.best)) }).toFixed(2)} output, or spend them on perks instead.
            </div>
            <button className="ac-btn" style={{ background: accent }} onClick={collapse}>Collapse</button>
            <button className="ac-tab" style={{ width: '100%', marginTop: 8 }} onClick={() => setConfirm(false)}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  );
}
