import { defineConfig } from 'vite';

export default defineConfig({
    // Serve the whole project in dev so examples/ (HTML, config.json, DataNFT,
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
