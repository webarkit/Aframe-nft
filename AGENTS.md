# AGENTS.md — Agent Guidelines for Aframe-nft

This document provides instructions for AI coding assistants (Antigravity, Claude, Copilot, Cursor, etc.) working on `Aframe-nft`.

---

## 1. Git Workflow & Branching Policy (CRITICAL)

- **Target branch is `dev`:**
  - `dev` is the active development branch. All Pull Requests must target `dev` (not `main`).
  - `main` is reserved for stable releases.
- **Always branch off `origin/dev`:**
  - Never commit directly to `dev` or `main`.
  - Always update `dev` first (`git checkout dev && git pull --ff-only origin dev`) and create a new feature/fix branch:
    ```bash
    git checkout -b <type>-<short-description>
    ```
- **Conventional Commits:**
  - Every commit must strictly follow [Conventional Commits](https://www.conventionalcommits.org/):
    - `feat: <description>` (new feature)
    - `fix: <description>` (bug fix)
    - `docs: <description>` (documentation updates)
    - `test: <description>` (adding or refactoring tests)
    - `refactor: <description>` (code restructuring without behavioral change)
    - `chore: <description>` (maintenance, dependencies, config)
  - Reference issues in the commit message or body where appropriate (`Fixes #NN`).
- **GPG Signing:**
  - All commits must be GPG-signed (`git commit -S` or with `commit.gpgsign=true`).

---

## 2. Project Architecture & Technologies

- **Project Purpose:**
  `Aframe-nft` is a WebXR/WebAR component library for A-Frame enabling markerless Natural Feature Tracking (NFT) image targets powered by `jsartoolkitNFT`.
- **Core Tech Stack:**
  - [A-Frame](https://aframe.io/) (`1.8.0`)
  - [`@webarkit/jsartoolkit-nft`](https://github.com/webarkit/jsartoolkitNFT) (`1.16.0`)
  - [`@webarkit/camera-view`](https://github.com/webarkit/camera-view) (`0.1.0`)
  - [`@webarkit/oneeurofilter-ts`](https://github.com/webarkit/OneEuroFilter-ts) (`0.2.0`)
  - Vite (`8.x`), Vitest (`5.x`) + `jsdom`
- **Key Modules (`src/`):**
  - [`src/registerNFT.js`](src/registerNFT.js): A-Frame glue: `arnft` system, `nft-anchor` component, and `<a-nft>` primitive.
  - [`src/markerRegistry.js`](src/markerRegistry.js): Bookkeeping for target URLs and reusable/shared target IDs (`_targets`, `_inFlight`, `_byId`). One loaded target per URL; multiple `<a-nft>` share one target ID.
  - [`src/markerLoader.js`](src/markerLoader.js): Loads target descriptor sets (`.fset`, `.fset3`, `.iset`, optional `.zft`) into the tracker.
  - [`src/frames.js`](src/frames.js): Per-frame routing of tracker poses and `lost` transitions to registered anchors.
  - [`src/trackerFactory.js`](src/trackerFactory.js): Factory creating tracker on the same thread or in a Web Worker (`worker: true`), with automatic fallback.
  - [`src/trackerSettings.js`](src/trackerSettings.js): Translates system attributes to jsartoolkitNFT tracker configuration.
  - [`src/poseFilter.js`](src/poseFilter.js) & [`src/so3.js`](src/so3.js): 1€ pose smoothing with Lie group SO(3) rigid rotation math.
  - [`src/nftMath.js`](src/nftMath.js): Marker centering, scaling, lift geometry, and matrix conversions.
  - [`src/cameraConstraints.js`](src/cameraConstraints.js): Maps ideal `videoWidth` and `videoHeight` through CameraView.

---

## 3. Development & Verification Rules

- **Separation of Concerns:**
  - Pure logic belongs in DOM-free modules in `src/` and must be covered by unit tests in `test/`.
  - DOM/A-Frame interactions belong in `src/registerNFT.js`.
- **Test-Driven Development (TDD):**
  - Always write failing tests first when fixing bugs or adding functionality.
  - Run tests with:
    ```bash
    npm test -- --run
    ```
- **Bundle Generation (`dist/`):**
  - `dist/AframeNft.js` is committed in git and validated by CI.
  - **Whenever any file in `src/` is modified, you MUST rebuild `dist/` before committing:**
    ```bash
    npm run build
    ```
- **Windows CRLF / Git Status Guard:**
  - On Windows, `dist/NFTTracker*.js` files may appear modified in `git status` due to line ending differences, even when `git diff` shows no real changes.
  - Never commit spurious line-ending diffs. Restore unchanged worker files before committing:
    ```bash
    git checkout -- dist/NFTTracker*.js
    ```
- **Examples & Routing:**
  - Examples reside under [`examples/`](examples/). Keep the index at [`examples/index.html`](examples/index.html).
  - Do NOT create a root `index.html` (it would cause Vite to return 200 on missing assets/descriptors instead of 404).

---

## 4. Architectural Invariants (Do Not Break)

1. **One tracker per scene:** AR tracking is managed at `<a-scene>` level by the `arnft` system, never instantiated per `<a-nft>`.
2. **One load per descriptor URL:** Distinct `<a-nft>` tags referencing the same `url` share one tracker target ID and loaded dataset.
3. **Anchor Lifecycle:**
   - Removing an `<a-nft>` element unregisters it from the system and hides its mesh (`onLost()`).
   - Appending the same element again restores tracking on the entity's `loaded` event (`_nftAnchorLoadedListener`).
   - Changing `url` at runtime unregisters the old target, clears state, and registers the new URL.
4. **Visibility:** Content stays hidden (`mesh.visible = false`) until the first valid pose is applied. Poses are written directly in `onPose()` to avoid 1-frame latency.
