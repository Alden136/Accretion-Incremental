# Accretion Incremental

An incremental game about growing from an atom to the observable universe.

## Development

Use Node.js 18 or newer. From this directory:

```sh
npm ci
npm test
npm run build
python3 -m http.server 8000
```

Open http://localhost:8000. `./build.sh` installs the locked dependencies and builds.
Commit `app.js` and `sw.js` with source changes. The build automatically derives the
service-worker cache version from the app shell; no manual version bump is needed.

Offline income earns 50% of accretor production for up to 8 hours by default.
Deep time raises the rate and cap growth; Long drift extends the window to 24 hours.
The mass cap uses peak mass, so spending before leaving does not lower it.
Self-assembly and Tidal resonance run only while the game is active.

Unreadable saves pause loading and autosave. The recovery screen exposes original
save data for copying and can retry loading. Starting fresh requires confirmation
and successfully backs up any readable original data before replacing it.
