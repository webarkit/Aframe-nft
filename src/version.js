/**
 * Version information, logged at start-up by `src/index.js` and exported as
 * `AframeNft.version` from the bundle.
 *
 * The values are injected at build time by Vite's `define` (see
 * `vite.config.js`), from `package.json` and the installed jsartoolkitNFT. When
 * the source is used without that step they fall back to `"unknown"`.
 *
 * @module version
 */

/* global __AFRAME_NFT_VERSION__, __JSARTOOLKIT_NFT_VERSION__ */

/** Aframe-nft version, from `package.json`. */
export const version =
    typeof __AFRAME_NFT_VERSION__ !== 'undefined' ? __AFRAME_NFT_VERSION__ : 'unknown';

/**
 * Version of the bundled jsartoolkitNFT. jsartoolkitNFT logs it too
 * (`ARToolkitNFT <version>`), but only once the tracker starts, i.e. once the
 * camera works. Having it in the banner means it is logged at load, even when
 * the camera fails.
 */
export const jsartoolkitNFTVersion =
    typeof __JSARTOOLKIT_NFT_VERSION__ !== 'undefined' ? __JSARTOOLKIT_NFT_VERSION__ : 'unknown';

/** The start-up console line: `Aframe-nft <version> (jsartoolkitNFT <version>)`. */
export const banner = `Aframe-nft ${version} (jsartoolkitNFT ${jsartoolkitNFTVersion})`;
