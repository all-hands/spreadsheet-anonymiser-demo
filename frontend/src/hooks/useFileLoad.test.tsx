import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ChangeEvent } from 'react';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));
vi.mock('../lib/worker-client', () => ({ createWorker: createWorkerMock }));

import { useFileLoad } from './useFileLoad';
import { MAX_FILE_BYTES } from '../lib/constants';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';

const eventFor = (file: File) => ({ target: { files: [file] } }) as unknown as ChangeEvent<HTMLInputElement>;

describe('useFileLoad guards', () => {
    it('reports an oversize file and never starts the worker', async () => {
        const onStatus = vi.fn();
        const big = new File(['x'], 'big.xlsx');
        Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
        const { result } = renderHook(() => useFileLoad(onStatus, vi.fn()));
        await act(() => result.current.loadFile(eventFor(big)));
        expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/^Error: .*100 MB.*anonymiser-cli/));
        expect(createWorkerMock).not.toHaveBeenCalled();
        expect(result.current.file).toBeNull();
    });

    it('reports an unsupported format', async () => {
        const onStatus = vi.fn();
        const { result } = renderHook(() => useFileLoad(onStatus, vi.fn()));
        await act(() => result.current.loadFile(eventFor(new File(['x'], 'a.pdf'))));
        expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/only supports \.csv, \.tsv, \.jsonl, \.xlsx and \.ods/));
        expect(createWorkerMock).not.toHaveBeenCalled();
    });
});

describe('useFileLoad races', () => {
    const PARSED = {
        headers: ['a'],
        data: [['1'], ['2']],
        metadata: [{ index: 0, header: 'a', type: 'text', confidence: 1 }],
        fileHash: 'h',
    };

    it('ignores a late progress callback after the load completed', async () => {
        useAdvancedSessionStore.getState().clearSession();
        let progress: ((m: string) => void) | undefined;
        createWorkerMock.mockReturnValue({
            parseFile: vi.fn(async (_f: File, cb: (m: string) => void) => {
                progress = cb;
                return PARSED;
            }),
        });
        const onStatus = vi.fn();
        const { result } = renderHook(() => useFileLoad(onStatus, vi.fn()));
        await act(() => result.current.loadFile(eventFor(new File(['a\n1\n2'], 'a.csv'))));
        expect(onStatus).toHaveBeenLastCalledWith('Loaded 2 rows.');

        progress?.('Parsed 2 CSV rows');
        expect(onStatus).toHaveBeenLastCalledWith('Loaded 2 rows.');
        expect(onStatus).not.toHaveBeenCalledWith('Parsed 2 CSV rows');
    });

    it('a superseded load neither reports nor stores its result', async () => {
        useAdvancedSessionStore.getState().clearSession();
        let finishFirst!: (v: typeof PARSED) => void;
        let firstProgress: ((m: string) => void) | undefined;
        createWorkerMock
            .mockReturnValueOnce({
                parseFile: vi.fn(
                    (_f: File, cb: (m: string) => void) =>
                        new Promise((res) => {
                            firstProgress = cb;
                            finishFirst = res;
                        })
                ),
            })
            .mockReturnValueOnce({ parseFile: vi.fn(async () => ({ ...PARSED, data: [['9']] })) });
        const onStatus = vi.fn();
        const onBusy = vi.fn();
        const { result } = renderHook(() => useFileLoad(onStatus, onBusy));
        let first!: Promise<void>;
        act(() => {
            first = result.current.loadFile(eventFor(new File(['x'], 'one.csv')));
        });
        await act(() => result.current.loadFile(eventFor(new File(['y'], 'two.csv'))));
        expect(onStatus).toHaveBeenLastCalledWith('Loaded 1 rows.');

        firstProgress?.('Parsed 2 CSV rows');
        await act(async () => {
            finishFirst(PARSED);
            await first;
        });
        expect(onStatus).toHaveBeenLastCalledWith('Loaded 1 rows.');
        expect(useAdvancedSessionStore.getState().parse?.fullData).toEqual([['9']]);
        expect(onBusy).toHaveBeenLastCalledWith(false);
        expect(onBusy.mock.calls.filter(([b]) => b === false)).toHaveLength(1);
    });

    it('a load cleared mid-flight leaves the session empty', async () => {
        useAdvancedSessionStore.getState().clearSession();
        let finish!: (v: typeof PARSED) => void;
        createWorkerMock.mockReturnValueOnce({
            parseFile: vi.fn(() => new Promise((res) => (finish = res))),
        });
        const { result } = renderHook(() => useFileLoad(vi.fn(), vi.fn()));
        let p!: Promise<void>;
        act(() => {
            p = result.current.loadFile(eventFor(new File(['x'], 'one.csv')));
        });
        act(() => useAdvancedSessionStore.getState().clearSession());
        await act(async () => {
            finish(PARSED);
            await p;
        });
        expect(useAdvancedSessionStore.getState().parse).toBeNull();
    });
});
