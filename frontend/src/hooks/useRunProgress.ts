import { useState } from 'react';
import { createWorker } from '../lib/worker-client';
import type { StreamProgress } from '../lib/worker-client';

export const useRunProgress = () => {
    const [progress, setProgress] = useState<StreamProgress | null>(null);
    return {
        progress,
        onProgress: (p: StreamProgress) => setProgress(p),
        reset: () => setProgress(null),
        cancel: () => {
            void createWorker().cancelStream();
        },
    };
};
