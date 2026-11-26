import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { routes } from './router';

const leaf = (path: string) => matchRoutes(routes, path)?.at(-1)?.route;

describe('routes', () => {
    it('keeps the app pages', () => {
        expect(leaf('/simple')?.path).toBe('simple');
        expect(leaf('/advanced/preview')?.path).toBe('preview');
    });

    it('sends an unknown path to the app, not to the error screen', () => {
        for (const path of ['/nonsense/', '/ceac37c0-0000-4000-8000-000000000000/', '/a%20b/']) {
            expect(leaf(path)?.path).toBe('*');
        }
    });
});
