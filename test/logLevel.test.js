import { describe, it, expect, vi, afterEach } from 'vitest';
import { toARLogLevel, DEFAULT_LOG_LEVEL } from '../src/logLevel.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('toARLogLevel', () => {
    it("maps each name to jsartoolkitNFT's ARLogLevel value", () => {
        // ARLogLevel in @webarkit/jsartoolkit-nft: Debug 0, Info 1, Warn 2, Error 3.
        expect(['debug', 'info', 'warn', 'error'].map(toARLogLevel)).toEqual([0, 1, 2, 3]);
    });

    it('ignores case', () => {
        expect(toARLogLevel('INFO')).toBe(1);
    });

    it('defaults to warn', () => {
        expect(DEFAULT_LOG_LEVEL).toBe('warn');
    });

    it('falls back to warn, with one warning, for an unknown name', () => {
        // A-Frame does not enforce `oneOf`, so a typo reaches this function.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(toARLogLevel('verbose')).toBe(2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('verbose');
    });
});
