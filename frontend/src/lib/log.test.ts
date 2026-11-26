import { describe, it, expect, vi, afterEach } from 'vitest';
import { logFailure } from './log';

afterEach(() => vi.restoreAllMocks());

describe('logFailure', () => {
    it('logs the context and error name but never the message or stack', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logFailure('Parse failed', new TypeError('bad cell: alice@example.com'));
        expect(spy).toHaveBeenCalledTimes(1);
        const logged = spy.mock.calls[0].map(String).join(' ');
        expect(logged).toBe('Parse failed (TypeError)');
        expect(logged).not.toContain('alice');
    });

    it('survives non-Error throwables', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logFailure('Run failed', 'secret-string');
        expect(spy.mock.calls[0].join(' ')).toBe('Run failed (string)');
    });
});
