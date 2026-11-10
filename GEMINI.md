# GEMINI.md — Antigravity & Gemini Agent Instructions for Aframe-nft

Operational instructions for Google Antigravity and Gemini CLI agents working in `Aframe-nft`.

## Core Project Invariants

- **Branching Policy:**
  - `dev` is the target branch for development.
  - Every task MUST start on a new branch created from `origin/dev`:
    ```bash
    git checkout dev
    git pull --ff-only origin dev
    git checkout -b <branch-name>
    ```
  - Pull Requests MUST be submitted against `dev`, never `main`.
- **Commit Standards:**
  - Conventional Commits: `<type>: <description>` (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, etc.).
  - Commits MUST be signed with GPG (`git commit -S` or `commit.gpgsign=true`).
- **Build & CI Invariant:**
  - `dist/AframeNft.js` is committed and validated in CI.
  - Any change to files under `src/` requires `npm run build` prior to committing.
- **Windows / Sandbox Awareness:**
  - Commands that create `.git/index.lock` or need external git auth may require `BypassSandbox: true` if blocked by sandbox isolation. Always try sandboxed first.
  - On Windows checkouts, `dist/NFTTracker*.js` can trigger false-positive diffs due to line endings. Restore with `git checkout -- dist/NFTTracker*.js` if modified without real content changes.

## Commands

- **Unit tests:** `npm test -- --run`
- **Build bundle:** `npm run build`
- **Dev server:** `npm run dev`

## Architecture Quick Reference

- **`src/registerNFT.js`:** A-Frame system (`arnft`), component (`nft-anchor`), primitive (`<a-nft>`).
- **`src/markerRegistry.js`:** Manages loaded and in-flight marker targets (`_targets`, `_inFlight`, `_byId`). One tracker target ID per URL, shared across multiple `<a-nft>`.
- **`src/markerLoader.js`:** Hands targets to `tracker.addNFTTargets` one URL at a time.
- **`src/frames.js`:** Routes tracker poses and `lost` transitions to anchor records. Checks `registry.has(record)` before invoking callbacks.
- **`src/trackerFactory.js`:** Sets up main-thread tracker or Web Worker tracker (`worker: true`).
- **`src/poseFilter.js` + `src/so3.js`:** 1€ filter with rigid body rotation smoothing.
- **`src/nftMath.js`:** Marker size calculations, centering, lift onto plane.
