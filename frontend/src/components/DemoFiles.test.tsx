import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DemoFiles } from './DemoFiles';
import { SAMPLES } from '../lib/samples';

afterEach(() => vi.unstubAllGlobals());

describe('DemoFiles', () => {
    it('offers one button per sample', () => {
        render(<DemoFiles onFile={() => {}} />);
        expect(screen.getAllByRole('button')).toHaveLength(SAMPLES.length);
    });

    it('fetches the chosen sample and hands it over as a named File', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('a,b\n1,2\n', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const onFile = vi.fn();
        render(<DemoFiles onFile={onFile} align="start" />);
        fireEvent.click(screen.getByRole('button', { name: /customers/i }));
        await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
        expect((onFile.mock.calls[0][0] as File).name).toBe('customers.csv');
    });

    it('reports a failed fetch and does not hand anything over', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })));
        const onFile = vi.fn();
        render(<DemoFiles onFile={onFile} />);
        fireEvent.click(screen.getByRole('button', { name: /patients/i }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/could not load.*404/i);
        expect(onFile).not.toHaveBeenCalled();
    });
});
