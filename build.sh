#!/usr/bin/env bash
# Rebuild app.js after editing Accretion.jsx.
# Needs node. Run from this folder.
set -e
npm install --no-save react@18 react-dom@18 esbuild@0.21.5
npx esbuild main.jsx \
  --bundle --minify --format=iife --target=es2019 \
  --loader:.jsx=jsx --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=app.js
echo "built app.js — bump CACHE in sw.js so your phone picks up the change"
