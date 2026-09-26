import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { version, jsartoolkitNFTVersion, banner } from '../src/version.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const pkg = readJson('../package.json');
const upstream = readJson('../node_modules/@webarkit/jsartoolkit-nft/package.json');

describe('version', () => {
    it('is the version in package.json', () => {
        expect(version).toBe(pkg.version);
    });

    it('reports the bundled jsartoolkitNFT version', () => {
        expect(jsartoolkitNFTVersion).toBe(upstream.version);
    });

    it('formats the start-up banner', () => {
        expect(banner).toBe(`Aframe-nft ${pkg.version} (jsartoolkitNFT ${upstream.version})`);
    });
});
