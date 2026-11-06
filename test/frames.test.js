import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeFrameResult } from '../src/frames.js';

describe('routeFrameResult', () => {
    const pose = new Float64Array(16);
    let component;
    let registry;

    beforeEach(() => {
        component = { onPose: vi.fn(), onLost: vi.fn() };
        const records = new Map([[0, { component }]]);
        registry = { get: (id) => records.get(id) ?? null };
    });

    it('sends a pose and the frame time to its record', () => {
        routeFrameResult(registry, { time: 42, targets: [{ id: 0, found: true, pose }], transitions: [] });
        expect(component.onPose).toHaveBeenCalledWith(pose, 42);
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
