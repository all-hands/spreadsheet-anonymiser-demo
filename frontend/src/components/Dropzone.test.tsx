import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dropzone } from './Dropzone';

afterEach(() => vi.restoreAllMocks());

describe('Dropzone keyboard access', () => {
    it('is a focusable, named button', () => {
        render(<Dropzone onFile={() => {}} />);
        const zone = screen.getByRole('button', { name: /upload a csv, tsv, jsonl, excel or ods file/i });
        expect(zone).toHaveAttribute('tabindex', '0');
        zone.focus();
        expect(zone).toHaveFocus();
        expect(zone.className).toMatch(/focus-visible:ring/);
    });

    it.each(['Enter', ' '])('opens the file dialog on %j', (key) => {
        const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        render(<Dropzone onFile={() => {}} />);
        fireEvent.keyDown(screen.getByRole('button', { name: /upload a csv/i }), { key });
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('ignores other keys', () => {
        const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        render(<Dropzone onFile={() => {}} />);
        fireEvent.keyDown(screen.getByRole('button', { name: /upload a csv/i }), { key: 'a' });
        expect(click).not.toHaveBeenCalled();
    });

    it('hands a selected file to the page', () => {
        const onFile = vi.fn();
        render(<Dropzone onFile={onFile} />);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['x'], 'a.csv');
        fireEvent.change(input, { target: { files: [file] } });
        expect(onFile).toHaveBeenCalledWith(file);
    });
});

describe('Dropzone demo files', () => {
    it('fetches a sample and hands it over as a named File', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('a,b\n1,2\n', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const onFile = vi.fn();
        render(<Dropzone onFile={onFile} />);
        fireEvent.click(screen.getByRole('button', { name: /customers/i }));
        await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
        expect(fetchMock).toHaveBeenCalledWith('/samples/customers.csv');
        const file = onFile.mock.calls[0][0] as File;
        expect(file.name).toBe('customers.csv');
        expect(file.type).toBe('text/csv');
        vi.unstubAllGlobals();
    });

    it('shows an error when the fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })));
        const onFile = vi.fn();
        render(<Dropzone onFile={onFile} />);
        fireEvent.click(screen.getByRole('button', { name: /patients/i }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/could not load.*404/i);
        expect(onFile).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('shows an error when the network is down', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
        render(<Dropzone onFile={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /orders/i }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/offline/);
        vi.unstubAllGlobals();
    });
});
