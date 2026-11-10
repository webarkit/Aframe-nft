import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextFrame, routeFrameResult } from '../src/frames.js';

describe('nextFrame', () => {
    it('returns the frame when camera-view really captured one', () => {
        const view = {
            frame: 5,
            getImage() {
                this.frame++;
                return 'new';
            },
        };
        expect(nextFrame(view)).toBe('new');
    });

    it('returns null when the frame-rate gate gave back the last frame', () => {
        const view = { frame: 5, getImage: () => 'copy of the last frame' };
        expect(nextFrame(view)).toBeNull();
    });
});

describe('routeFrameResult', () => {
    const pose = new Float64Array(16);
    let component;
    let registry;

    beforeEach(() => {
        component = { onPose: vi.fn(), onLost: vi.fn() };
        const records = new Map([[0, [{ component }]]]);
        registry = { recordsFor: (id) => records.get(id) ?? [] };
    });

    it('ignores a skipped frame', () => {
        expect(() => routeFrameResult(registry, { skipped: true })).not.toThrow();
        expect(component.onPose).not.toHaveBeenCalled();
    });

    it('sends a pose and the frame time to its record', () => {
        routeFrameResult(registry, { time: 42, targets: [{ id: 0, found: true, pose }], transitions: [] });
        expect(component.onPose).toHaveBeenCalledWith(pose, 42);
    });

    it('routes one target to every record on it (#11)', () => {
        const first = { onPose: vi.fn(), onLost: vi.fn() };
        const second = { onPose: vi.fn(), onLost: vi.fn() };
        const shared = { recordsFor: (id) => (id === 0 ? [{ component: first }, { component: second }] : []) };
        routeFrameResult(shared, {
            time: 1,
            targets: [{ id: 0, found: true, pose }],
            transitions: [{ type: 'lost', id: 0 }],
        });
        expect(first.onPose).toHaveBeenCalledWith(pose, 1);
        expect(second.onPose).toHaveBeenCalledWith(pose, 1);
        expect(first.onLost).toHaveBeenCalledTimes(1);
        expect(second.onLost).toHaveBeenCalledTimes(1);
    });

    it('does not invoke onPose or onLost on a record removed during the same frame fan-out', () => {
        let shared;
        const first = {
            onPose: vi.fn(() => {
                shared.remove(secondRecord);
            }),
            onLost: vi.fn(() => {
                shared.remove(secondRecord);
            }),
        };
        const second = { onPose: vi.fn(), onLost: vi.fn() };
        const firstRecord = { component: first };
        const secondRecord = { component: second };
        const live = new Set([firstRecord, secondRecord]);
        shared = {
            recordsFor: (id) => (id === 0 ? [firstRecord, secondRecord] : []),
            has: (record) => live.has(record),
            remove: (record) => live.delete(record),
        };
        routeFrameResult(shared, {
            time: 1,
            targets: [{ id: 0, found: true, pose }],
            transitions: [],
        });
        expect(first.onPose).toHaveBeenCalledWith(pose, 1);
        expect(second.onPose).not.toHaveBeenCalled();

        // Also test the lost transition fan-out
        first.onPose.mockReset();
        second.onPose.mockReset();
        live.add(secondRecord);
        routeFrameResult(shared, {
            time: 2,
            targets: [],
            transitions: [{ type: 'lost', id: 0 }],
        });
        expect(first.onLost).toHaveBeenCalledTimes(1);
        expect(second.onLost).not.toHaveBeenCalled();
    });

    it('skips a target with no pose (the grace window before lost)', () => {
        routeFrameResult(registry, { time: 42, targets: [{ id: 0, found: false, pose: null }], transitions: [] });
        expect(component.onPose).not.toHaveBeenCalled();
        expect(component.onLost).not.toHaveBeenCalled();
    });

    it('ignores an id with no record: a target whose <a-nft> was removed', () => {
        expect(() =>
            routeFrameResult(registry, {
                time: 42,
                targets: [{ id: 9, found: true, pose }],
                transitions: [{ type: 'lost', id: 9 }],
            }),
        ).not.toThrow();
        expect(component.onPose).not.toHaveBeenCalled();
        expect(component.onLost).not.toHaveBeenCalled();
    });

    it('calls onLost for a lost transition and ignores found', () => {
        routeFrameResult(registry, {
            time: 42,
            targets: [],
            transitions: [
                { type: 'found', id: 0 },
                { type: 'lost', id: 0 },
            ],
        });
        expect(component.onLost).toHaveBeenCalledTimes(1);
    });
});
