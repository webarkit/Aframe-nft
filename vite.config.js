import fs from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const jsartoolkitNFT = require('@webarkit/jsartoolkit-nft/package.json');

// What createNFTTrackerWorker() loads, from the folder of AframeNft.js by default.
const TRACKER_WORKER_FILES = [
    'NFTTracker.worker.js',
    'NFTTracker_simd.worker.js',
    'NFTTracker_td.worker.js',
    'NFTTracker_td.pthread.js',
];

/**
 * Copy the tracker's Worker files next to the bundle. A file that is missing fails
 * the build, which is what we want if the package ever renames one.
 *
 * @returns {import('vite').Plugin}
 */
function copyTrackerWorkerFiles() {
    return {
        name: 'copy-tracker-worker-files',
        apply: 'build',
        // Not earlier: the build empties dist/ when it starts.
        closeBundle() {
            for (const file of TRACKER_WORKER_FILES) {
                fs.copyFileSync(`node_modules/@webarkit/jsartoolkit-nft/dist/${file}`, `dist/${file}`);
            }
        },
    };
}

export default defineConfig({
    plugins: [copyTrackerWorkerFiles()],
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
