# CLAUDE.md — Claude Code Guidelines for Aframe-nft

Guidance for Claude Code agents working in `webarkit/Aframe-nft`.

> **Canonical Guidelines:** Refer to [`AGENTS.md`](./AGENTS.md) as the single source of truth for repository architecture, branching policy, Conventional Commits, GPG signing, and architectural invariants.

## Essential Commands

- **Run unit tests:** `npm test -- --run`
- **Run tests in watch mode:** `npm test`
- **Build production bundle:** `npm run build` (required before committing changes to `src/`)
- **Start dev server with examples:** `npm run dev`

## Core Workflow Rules

- **Branching Policy:** Always branch off `origin/dev` (`git checkout -b <branch-name> origin/dev`) and target Pull Requests to `dev`. Never commit directly to `dev` or `main`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), GPG-signed.
- **TDD:** Write failing unit tests in `test/` before implementing changes in `src/`.
- **Build Invariant:** `dist/AframeNft.js` is committed in git; always run `npm run build` and verify `git diff` before committing.
- **Windows Line Endings:** If `dist/NFTTracker*.js` appears modified with whitespace/line-ending differences only (`git diff --ignore-space-at-eol`), restore before committing (`git checkout -- dist/NFTTracker*.js`).
