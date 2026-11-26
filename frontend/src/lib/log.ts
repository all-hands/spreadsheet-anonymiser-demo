export const logFailure = (context: string, err: unknown): void => {
    console.error(`${context} (${err instanceof Error ? err.name : typeof err})`);
};
