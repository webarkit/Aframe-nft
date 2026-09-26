import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { banner, version as expectedVersion } from '../src/version.js';

vi.mock('aframe', () => ({}));
vi.mock('@webarkit/jsartoolkit-nft', () => ({ ARControllerNFT: {} }));

// The entry point registers everything on the AFRAME global: stub just enough
// of it for the import to run.
let entry;
let log;
// Lines logged while importing. Captured here because Vitest clears a spy's
// call history before each test.
let startupLines;

beforeAll(async () => {
    globalThis.AFRAME = {
        registerSystem: () => {},
        registerComponent: () => {},
        registerPrimitive: () => {},
        primitives: { getMeshMixin: () => ({}) },
        utils: { extendDeep: (target, ...sources) => Object.assign(target, ...sources) },
    };
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    entry = await import('../src/index.js');
    startupLines = log.mock.calls.map(([line]) => line);
});

afterAll(() => {
    log.mockRestore();
});

describe('entry point', () => {
    it('logs the version banner once at start-up', () => {
        expect(startupLines.filter((line) => line === banner)).toHaveLength(1);
    });

    it('exports the version, available as AframeNft.version in the bundle', () => {
        expect(entry.version).toBe(expectedVersion);
    });
});
