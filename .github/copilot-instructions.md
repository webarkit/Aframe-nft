# GitHub Copilot Instructions for Aframe-nft

You are an expert AI pair programmer helping develop `webarkit/Aframe-nft`.

## Project Overview

`Aframe-nft` is a WebAR component library for [A-Frame](https://aframe.io/) (`1.8.0`) that brings Natural Feature Tracking (NFT) markerless AR to the web using [`@webarkit/jsartoolkit-nft`](https://github.com/webarkit/jsartoolkitNFT) (`1.16.0`) and [`@webarkit/camera-view`](https://github.com/webarkit/camera-view) (`0.1.0`).

## Git & Contribution Rules

1. **Development Branch (`dev`):**
   - All development is based on and targets `dev`.
   - Never commit directly to `dev` or `main`.
   - Always create a new branch from `origin/dev` for each task: `git checkout -b <branch-name> origin/dev`.
   - All PRs must target the `dev` branch.
2. **Conventional Commits:**
   - Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
3. **GPG Signing:**
   - All commits must be GPG-signed.

## Build and Testing

- **Tests:** `npm test -- --run` runs Vitest tests in jsdom environment.
- **Build:** `npm run build` runs Vite build to bundle `dist/AframeNft.js`.
- **CI Requirement:** `dist/AframeNft.js` is committed in git. Every change in `src/` MUST be accompanied by a fresh `npm run build` before committing.

## Architecture Guidelines

- **Keep DOM-free logic decoupled:** All marker loading, registry bookkeeping, frame routing, filter maths, and constraint logic live in separate modules in `src/` and are unit-tested without A-Frame or DOM.
- **Single Tracker per Scene:** There is strictly one tracker instance per `<a-scene>` created by the `arnft` system, not one per target.
- **Shared Target IDs:** Multiple `<a-nft>` primitive tags with the same `url` share one loaded target ID in `MarkerRegistry`.
- **Anchor Lifecycle:**
  - Removing an `<a-nft>` unregisters its marker and hides the mesh (`onLost()`).
  - Appending the same element back restores tracking via the entity's `loaded` event (`_nftAnchorLoadedListener`).
  - Changing `url` at runtime unregisters the old marker, hides content, and registers the new target URL.
- **Preserve Examples:** Keep examples in `examples/`. Never add an `index.html` at the project root.
