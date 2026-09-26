import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const jsartoolkitNFT = require('@webarkit/jsartoolkit-nft/package.json');

export default defineConfig({
    // Versions baked into the code at build time (see src/version.js), so they
    // always match package.json and the installed jsartoolkitNFT. Applies to
    // dev, build and tests alike.
    define: {
        __AFRAME_NFT_VERSION__: JSON.stringify(pkg.version),
        __JSARTOOLKIT_NFT_VERSION__: JSON.stringify(jsartoolkitNFT.version),
    },
    // Serve the whole project in dev so examples/ (HTML, DataNFT descriptors,
    // camera_para.dat) load alongside the source modules.
    server: {
        port: 8080,
        // The examples index. Keep it in examples/: a root index.html would
        // become Vite's fallback page for every missing file.
        open: '/examples/',
    },
    build: {
        // Library build: a single global bundle, matching the historical
        // dist/AframeNft.js consumed by <script> tags.
        lib: {
            entry: 'src/index.js',
            name: 'AframeNft',
            formats: ['iife'],
            fileName: () => 'AframeNft.js',
        },
        outDir: 'dist',
        emptyOutDir: true,
    },
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.js'],
    },
});
