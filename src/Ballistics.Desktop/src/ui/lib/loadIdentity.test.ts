import { describe, expect, it } from 'vitest';
import { reconcileSelectedLoadId } from './loadIdentity';

describe('stable load identity', () => {
    it('preserves a newly added custom ID while the visible result is still old', () => {
        expect(
            reconcileSelectedLoadId(
                'custom:new',
                ['builtin:first', 'builtin:second'],
                ['custom:new'],
                true,
            ),
        ).toBe('custom:new');
    });

    it('does not reconcile selection against a stale result', () => {
        expect(reconcileSelectedLoadId('custom:new', ['builtin:first'], [], false)).toBe(
            'custom:new',
        );
    });

    it('falls back to the first current result only when the ID no longer exists', () => {
        expect(reconcileSelectedLoadId('custom:removed', ['builtin:first'], [], true)).toBe(
            'builtin:first',
        );
    });

    it('preserves selection when result order changes', () => {
        expect(
            reconcileSelectedLoadId(
                'builtin:second',
                ['builtin:second', 'builtin:first'],
                [],
                true,
            ),
        ).toBe('builtin:second');
    });
});
