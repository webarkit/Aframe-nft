import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTracker, WORKER_START_TIMEOUT_MS } from '../src/trackerFactory.js';

const config = { width: 320, height: 240, cameraParam: 'c' };
const factories = () => ({
    createNFTTracker: vi.fn(async () => 'same'),
    createNFTTrackerWorker: vi.fn(async () => 'worker'),
});

describe('createTracker', () => {
    const signal = new AbortController().signal;
    let timeout;

    beforeEach(() => {
        // Spied so that no real 30 s timer outlives a test.
        timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    });

    afterEach(() => {
        timeout.mockRestore();
    });

    it('uses the same thread by default', async () => {
        const f = factories();
        expect(await createTracker(config, { worker: false, workerBase: '' }, f)).toBe('same');
        expect(f.createNFTTracker).toHaveBeenCalledWith(config);
        expect(f.createNFTTrackerWorker).not.toHaveBeenCalled();
    });

    it('uses the Worker on request, bounding its start', async () => {
        const f = factories();
        expect(await createTracker(config, { worker: true, workerBase: '' }, f)).toBe('worker');
        const [workerConfig, opts] = f.createNFTTrackerWorker.mock.calls[0];
        expect(workerConfig).toBe(config);
        expect(timeout).toHaveBeenCalledWith(WORKER_START_TIMEOUT_MS);
        expect(WORKER_START_TIMEOUT_MS).toBe(30000);
        expect(opts.signal).toBe(signal);
        expect(opts).not.toHaveProperty('workerBase'); // empty: next to the bundle
        expect(f.createNFTTracker).not.toHaveBeenCalled();
    });

    it('passes workerBase when set', async () => {
        const f = factories();
        await createTracker(config, { worker: true, workerBase: '/nft/' }, f);
        expect(f.createNFTTrackerWorker.mock.calls[0][1].workerBase).toBe('/nft/');
    });

    it('falls back to the same thread and warns when the Worker cannot start', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const f = factories();
        f.createNFTTrackerWorker.mockRejectedValue(new Error('the worker failed to start'));
        expect(await createTracker(config, { worker: true, workerBase: '' }, f)).toBe('same');
        expect(f.createNFTTracker).toHaveBeenCalledWith(config);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('arnft:');
        warn.mockRestore();
    });

    it('rejects when the same thread cannot start either', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const f = factories();
        const failure = new Error('no camera file');
        f.createNFTTrackerWorker.mockRejectedValue(new Error('no camera file'));
        f.createNFTTracker.mockRejectedValue(failure);
        await expect(createTracker(config, { worker: true, workerBase: '' }, f)).rejects.toBe(failure);
        warn.mockRestore();
    });
});
