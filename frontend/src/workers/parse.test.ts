import { describe, it, expect, vi } from 'vitest';

vi.mock('./wasm', () => ({ ensureWasm: vi.fn(async () => {}) }));

import { parseFile } from './parse';
import { MAX_FILE_BYTES } from '../lib/constants';

const fileOfSize = (name: string, size: number): File => {
    const file = new File(['a,b\n1,2\n'], name);
    Object.defineProperty(file, 'size', { value: size });
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(), configurable: true });
    return file;
};

describe('parseFile guards', () => {
    it('rejects an oversize file BEFORE reading it', async () => {
        const file = fileOfSize('big.xlsx', MAX_FILE_BYTES + 1);
        const read = file.arrayBuffer as ReturnType<typeof vi.fn>;
        await expect(parseFile(file)).rejects.toThrow(/limit.*anonymiser-cli/s);
        expect(read).not.toHaveBeenCalled();
    });

    it('rejects an unsupported format before reading it', async () => {
        const file = fileOfSize('notes.txt', 10);
        const read = file.arrayBuffer as ReturnType<typeof vi.fn>;
        await expect(parseFile(file)).rejects.toThrow(/only supports \.csv, \.tsv, \.jsonl, \.xlsx and \.ods/);
        expect(read).not.toHaveBeenCalled();
    });
});
