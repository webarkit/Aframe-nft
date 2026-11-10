# GEMINI.md — Antigravity & Gemini Agent Instructions for Aframe-nft

Operational instructions for Google Antigravity and Gemini CLI agents working in `Aframe-nft`.

> **Canonical Guidelines:** Refer to [`AGENTS.md`](./AGENTS.md) as the single source of truth for repository architecture, branching policy, Conventional Commits, GPG signing, and architectural invariants.

## Essential Commands

- **Unit tests:** `npm test -- --run`
- **Build bundle:** `npm run build` (required before committing any change to `src/`)
- **Dev server:** `npm run dev`

## Antigravity Environment & Execution Notes

- **Branching Policy:** Always branch off `origin/dev` (`git checkout -b <branch-name> origin/dev`) and target Pull Requests to `dev`.
- **Commits:** Conventional Commits only (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), GPG-signed.
- **Sandbox Security:** Always run commands inside the default sandbox first (`BypassSandbox: false`). Any command running outside the sandbox (`BypassSandbox: true`) requires explicit user confirmation.
- **Windows Line Endings:** Check `git diff --ignore-space-at-eol -- dist/NFTTracker*.js` before committing. Restore unchanged worker files with `git checkout -- dist/NFTTracker*.js` if differences are CRLF/LF only.
