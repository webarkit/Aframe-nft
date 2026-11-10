# GitHub Copilot Instructions for Aframe-nft

You are an expert AI pair programmer helping develop `webarkit/Aframe-nft`.

> **Canonical Guidelines:** Refer to [`AGENTS.md`](../AGENTS.md) as the single source of truth for repository architecture, branching policy, Conventional Commits, GPG signing, and architectural invariants.

## Essential Invariants

1. **Development Branch (`dev`):**
   - Branch off `origin/dev` (`git checkout -b <branch-name> origin/dev`) and target all Pull Requests to `dev`. Never commit directly to `dev` or `main`.
2. **Conventional Commits & GPG:**
   - Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Commits must be GPG-signed.
3. **Build & CI Verification:**
   - `dist/AframeNft.js` is committed in git. Every change in `src/` requires `npm run build` and `npm test -- --run` before committing.
4. **Architectural Invariants:**
   - Exactly one tracker per `<a-scene>` (managed by `arnft` system).
   - Marker targets with the same `url` share one tracker target ID in `MarkerRegistry`.
   - Pure logic resides in DOM-free modules under `src/` with corresponding unit tests in `test/`.
