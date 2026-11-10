# CLAUDE.md — Claude Code Guidelines for Aframe-nft

Guidance for Claude Code agents working in the `webarkit/Aframe-nft` repository.

## Commands

- **Run unit tests:** `npm test -- --run`
- **Run tests with watch:** `npm test`
- **Build production bundle:** `npm run build`
- **Start dev server with examples:** `npm run dev`

## Branching & PR Strategy

- **Development branch:** `dev`. All feature/bugfix branches MUST be created from `origin/dev` and PRs MUST target `dev`.
  ```bash
  git checkout dev
  git pull --ff-only origin dev
  git checkout -b <branch-name>
  ```
- **Never commit to `dev` or `main` directly.**
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- **GPG Signing:** Commits must be signed with GPG (`git commit -S` or with `commit.gpgsign=true`).

## Code Architecture

- **`src/registerNFT.js`:** A-Frame glue (`arnft` system, `nft-anchor` component, `<a-nft>` primitive). Keep this minimal; delegate logic to DOM-free modules.
- **`src/markerRegistry.js`:** Manages loaded and in-flight marker records. Deduplicates by URL: multiple `<a-nft>` with the same descriptor URL share a single tracker target ID.
- **`src/markerLoader.js`:** Loads NFT descriptor sets via `addNFTTargets` without blocking unrelated targets.
- **`src/frames.js`:** Routes poses and `lost` transitions to registered anchors. Only routes to currently registered anchors (`registry.has(record)`).
- **`src/trackerFactory.js`:** Initializes tracking on the main thread or Web Worker (`worker: true` on `arnft` system) with automatic fallback.
- **`src/poseFilter.js` & `src/so3.js`:** 1€ filter with rigid 3D pose smoothing via Lie group SO(3) maths.
- **`src/nftMath.js`:** Target centering, scaling, and plane lifting geometry.

## Development Rules

1. **Test-Driven Development:** Write failing tests in `test/` before implementing changes. Run `npm test -- --run`.
2. **Rebuild Bundle on `src/` Changes:** `dist/AframeNft.js` is committed to git and checked in CI. Always run `npm run build` when modifying `src/`.
3. **Windows Line Endings:** Avoid committing spurious line ending changes in `dist/NFTTracker*.js`. If modified with empty diff, run `git checkout -- dist/NFTTracker*.js`.
4. **Examples Folder:** Examples are in `examples/`. Never create an `index.html` at the project root.
5. **No per-anchor tracker:** There is exactly ONE tracker per `<a-scene>`, never one tracker per `<a-nft>`.
