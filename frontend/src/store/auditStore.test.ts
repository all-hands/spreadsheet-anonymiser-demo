import { describe, it, expect, beforeEach } from 'vitest';
import { useAuditStore } from '../store/auditStore';

describe('auditStore', () => {
    beforeEach(() => {
        useAuditStore.setState({ currentLog: null });
    });

    describe('startNewLog', () => {
        it('creates a new audit log with pending status', () => {
            const { startNewLog } = useAuditStore.getState();

            const id = startNewLog('test.csv', 1024, 100, 5);

            const { currentLog } = useAuditStore.getState();
            expect(currentLog?.id).toBe(id);
            expect(currentLog?.filename).toBe('test.csv');
            expect(currentLog?.fileSize).toBe(1024);
            expect(currentLog?.totalRows).toBe(100);
            expect(currentLog?.totalColumns).toBe(5);
            expect(currentLog?.status).toBe('pending');
            expect(currentLog?.entries).toHaveLength(0);
        });

        it('records the file hash for the signed certificate', () => {
            const { startNewLog } = useAuditStore.getState();

            startNewLog('test.csv', 1024, 100, 5, 'abc123hash');

            expect(useAuditStore.getState().currentLog?.fileHash).toBe('abc123hash');
        });
    });

    describe('addEntry', () => {
        it('adds an entry to the current log', () => {
            const { startNewLog, addEntry } = useAuditStore.getState();

            startNewLog('test.csv', 1024, 100, 5);
            addEntry({
                columnIndex: 0,
                columnName: 'email',
                operation: 'redact',
                rowsAffected: 100,
            });

            const { currentLog } = useAuditStore.getState();
            expect(currentLog?.entries).toHaveLength(1);
            expect(currentLog?.entries[0].operation).toBe('redact');
            expect(currentLog?.status).toBe('processing');
        });

        it('does nothing if no current log exists', () => {
            const { addEntry } = useAuditStore.getState();

            addEntry({ columnIndex: 0, columnName: 'email', operation: 'redact', rowsAffected: 100 });

            expect(useAuditStore.getState().currentLog).toBeNull();
        });
    });

    describe('completeLog', () => {
        it('marks the log as completed', () => {
            const { startNewLog, completeLog } = useAuditStore.getState();

            startNewLog('test.csv', 1024, 100, 5);
            completeLog();

            const { currentLog } = useAuditStore.getState();
            expect(currentLog?.status).toBe('completed');
            expect(currentLog?.completedAt).toBeDefined();
        });
    });

    describe('failLog', () => {
        it('marks the log as failed with error message', () => {
            const { startNewLog, failLog } = useAuditStore.getState();

            startNewLog('test.csv', 1024, 100, 5);
            failLog('Something went wrong');

            const { currentLog } = useAuditStore.getState();
            expect(currentLog?.status).toBe('failed');
            expect(currentLog?.errorMessage).toBe('Something went wrong');
        });
    });

    describe('getSummary', () => {
        it('counts columns per operation across the whole vocabulary', () => {
            const { startNewLog, addEntry, getSummary } = useAuditStore.getState();

            startNewLog('test.csv', 1024, 100, 5);
            addEntry({ columnIndex: 0, columnName: 'email', operation: 'redact', rowsAffected: 100 });
            addEntry({ columnIndex: 1, columnName: 'name', operation: 'hash', rowsAffected: 90 });
            addEntry({ columnIndex: 2, columnName: 'id', operation: 'keep', rowsAffected: 0 });
            addEntry({ columnIndex: 3, columnName: 'note', operation: 'kyber-aes', rowsAffected: 80 });
            addEntry({ columnIndex: 4, columnName: 'old', operation: 'legacy-mask', rowsAffected: 70 });

            const summary = getSummary();
            expect(summary?.byOperation['redact']).toBe(1);
            expect(summary?.byOperation['hash']).toBe(1);
            expect(summary?.byOperation['keep']).toBe(1);
            expect(summary?.byOperation['kyber-aes']).toBe(1);
            expect(summary?.byOperation['legacy-mask']).toBe(1);
            expect(summary?.totalTransformations).toBe(340);
        });

        it('returns null if no current log', () => {
            expect(useAuditStore.getState().getSummary()).toBeNull();
        });
    });
});
