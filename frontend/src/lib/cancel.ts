export const CANCELLED_MESSAGE = 'Cancelled.';

export class CancelledError extends Error {
    constructor() {
        super(CANCELLED_MESSAGE);
        this.name = 'CancelledError';
    }
}

export const isCancelled = (err: unknown): boolean =>
    err instanceof Error && err.message === CANCELLED_MESSAGE;
