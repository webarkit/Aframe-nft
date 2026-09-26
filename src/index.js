/**
 * Aframe-nft entry point.
 *
 * Importing this module registers, on the global `AFRAME`:
 * - the `arnft` system (camera + jsartoolkitNFT tracker),
 * - the `nft-anchor` component,
 * - the `<a-nft>` primitive.
 *
 * It then logs the version banner, `Aframe-nft <version> (jsartoolkitNFT
 * <version>)`, right after A-Frame's own. The IIFE bundle `dist/AframeNft.js` is
 * built from here, also contains A-Frame and jsartoolkitNFT, and exposes this
 * module's exports as the `AframeNft` global (`AframeNft.version`).
 */
import './registerNFT';
import { banner } from './version';

export { version } from './version';

console.log(banner);
