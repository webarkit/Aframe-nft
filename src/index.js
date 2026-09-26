/**
 * Aframe-nft entry point.
 *
 * Importing this module registers, on the global `AFRAME`:
 * - the `arnft` system (camera + jsartoolkitNFT tracker),
 * - the `nft-anchor` component,
 * - the `<a-nft>` primitive.
 *
 * It exports nothing. The IIFE bundle `dist/AframeNft.js` is built from here
 * and also contains A-Frame and jsartoolkitNFT.
 */
import './registerNFT';
