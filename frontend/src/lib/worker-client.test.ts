import { afterEach, describe, expect, it } from 'vitest';

import { createWorker, setWorkerFactoryForTests, WorkerFatalError } from './worker-client';

class NeverAnsweringWorker {
    onerror: ((ev: { message: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    private listeners = new Map<string, ((ev: unknown) => void)[]>();

    addEventListener(type: string, listener: (ev: unknown) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, listener: (ev: unknown) => void) {
        this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((l) => l !== listener)
        );
    }

    postMessage() {}

    die(message = 'script load failed') {
        this.onerror?.({ message } as ErrorEvent);
    }
}

afterEach(() => setWorkerFactoryForTests(null));

describe('worker death', () => {
    it('rejects pending and future calls with WorkerFatalError', async () => {
        const fake = new NeverAnsweringWorker();
        setWorkerFactoryForTests(() => fake as unknown as Worker);
        const api = createWorker();

        const pending = api.endSession();
        const pendingToo = api.generateFile(['header'], [['x']], 'csv');

        fake.die();

        await expect(pending).rejects.toBeInstanceOf(WorkerFatalError);
        await expect(pending).rejects.toThrow('processing engine failed: script load failed');
        await expect(pendingToo).rejects.toBeInstanceOf(WorkerFatalError);

        const afterDeath = api.endSession();
        await expect(afterDeath).rejects.toBeInstanceOf(WorkerFatalError);
    }, 1000);
});
