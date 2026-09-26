# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may include breaking
changes.

## [0.2.0] — 2026-09-26

First public release. Compared with 0.1.0, the jsartoolkitNFT integration on `main`, it adds
multiple and dynamic targets, pose smoothing, and much tighter documentation and tooling.

### Added

- **Multiple targets tracked at the same time.** Declare one `<a-nft>` per image target; each
  gets its own pose ([#8], [#9], [#10]).
- **Runtime add and remove.** `<a-nft>` elements can be added or removed while the scene runs.
  Re-adding a target with the same `url` reuses the one already loaded ([#5], [#10]). See
  `examples/dynamic.html`.
- **New `arnft` attributes:**
  - `lostTimeout`: how long a target may go unseen before its content hides ([#9]);
  - `continuousDetection` and `detectionInterval`: jsartoolkitNFT's detection policy ([#10]);
  - `logLevel`, default `warn`: tracker console verbosity ([#20]).
- **Pose smoothing.** A 1€ filter, on by default: `smooth`, `smoothMinCutoff` and
  `smoothBeta` on `nft-anchor` ([#3]).
- **`lift` on `nft-anchor`.** Content rests on the target, based on its bounding box; `false`
  centres it on the target plane instead ([#4]).
- **Version banner.** A start-up line (`Aframe-nft <version> (jsartoolkitNFT <version>)`), and
  the version from code as `AframeNft.version` ([#19], [#20]).
- **Examples index.** `examples/index.html`, which `npm run dev` now opens ([#10]).
- **CI.** GitHub Actions run the tests and the build, and check that the committed `dist/` is
  up to date ([#18]).

### Changed

- **Bundled libraries.** jsartoolkitNFT 1.10.1 → **1.13.0** and A-Frame 1.7.1 → **1.8.0**
  (THREE r173 → r184). Both are bundled in `dist/AframeNft.js`, so do not load A-Frame
  separately ([#10], [#18]).
- **Visibility.** Content visibility now comes from pose timestamps instead of jsartoolkitNFT's
  `lostNFTMarker` event, which was unreliable with several targets ([#9]).
- **Marker loading.** Targets load one per request, so a bad `url` affects only its own
  `<a-nft>` ([#10]).
- **Smoothing implementation.** Pose smoothing now uses `@webarkit/oneeurofilter-ts`, with
  results identical to the previous in-house filter. Each `<a-nft>` builds its filter once;
  changing an unrelated attribute no longer resets the smoothing ([#18], [#20]).
- **Quieter console by default.** `logLevel: warn` hides ARToolKit's per-frame tracking lines;
  use `logLevel: info` when debugging detection ([#20]).
- **License text.** `LICENSE` now holds LGPL-3.0, matching the declared LGPL-3.0-or-later.
  `COPYING` adds the GPL-3.0 text ([#18]).
- **Tooling.** Vite 8, Vitest 5 and jsdom 30 ([#18]).
- **Documentation.** The README is rewritten, and the sources carry JSDoc ([#18]).

### Fixed

- **Frozen content.** With several targets, a target leaving the view could leave its content
  frozen on screen ([#8], [#9]). The same happened when an `<a-nft>` was removed ([#10]).
- **Camera start-up.** It failed on desktops whose last listed camera is a virtual one (for
  example Meta Quest Link). It now falls back to the `facingMode` choice ([#10]).
- **`getImage()`** no longer copies the camera frame on every call ([#6], [#10]).
- **Mesh lift** is now correct for meshes other than a unit cube ([#4]).

### Removed

- **Unused example files** from the ARnft era: `examples/config.json`, two images, and an
  unreferenced `.zft` ([#18], [#20]).

## [0.1.0]

jsartoolkitNFT integrated directly, replacing ARnft, with Vite tooling and the first unit
tests ([#2]). Not released.

[0.2.0]: https://github.com/webarkit/Aframe-nft/releases/tag/v0.2.0
[0.1.0]: https://github.com/webarkit/Aframe-nft/pull/2
[#2]: https://github.com/webarkit/Aframe-nft/pull/2
[#3]: https://github.com/webarkit/Aframe-nft/pull/3
[#4]: https://github.com/webarkit/Aframe-nft/pull/4
[#5]: https://github.com/webarkit/Aframe-nft/issues/5
[#6]: https://github.com/webarkit/Aframe-nft/issues/6
[#8]: https://github.com/webarkit/Aframe-nft/issues/8
[#9]: https://github.com/webarkit/Aframe-nft/pull/9
[#10]: https://github.com/webarkit/Aframe-nft/pull/10
[#18]: https://github.com/webarkit/Aframe-nft/pull/18
[#19]: https://github.com/webarkit/Aframe-nft/issues/19
[#20]: https://github.com/webarkit/Aframe-nft/pull/20
