import { useState } from 'react';
import Explain from './Explain';
import { SAMPLES, loadSample, type Sample } from '../lib/samples';

interface DemoFilesProps {
    onFile: (file: File) => void;
    align?: 'center' | 'start';
}

export const DemoFiles = ({ onFile, align = 'center' }: DemoFilesProps) => {
    const [sampleError, setSampleError] = useState<string | null>(null);
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const onSample = async (sample: Sample) => {
        setSampleError(null);
        setLoadingId(sample.id);
        try {
            onFile(await loadSample(sample));
        } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            setSampleError(`Could not load the demo file "${sample.label}" (${why}). Check your connection and try again.`);
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <div className={align === 'center' ? 'text-center' : 'text-left'} aria-label="Demo files">
            <Explain k="demo.group">
                <p className="text-sm text-muted">Or try a demo file (made-up data)</p>
            </Explain>
            <div className={`mt-2 flex flex-wrap gap-2 ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
                {SAMPLES.map((s) => (
                    <Explain key={s.id} k="demo.group" text={s.description}>
                    <button
                        type="button"
                        disabled={loadingId !== null}
                        onClick={() => void onSample(s)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-muted text-foreground hover:border-accent-hover hover:bg-surface-hover disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {loadingId === s.id ? 'Loading...' : s.label}
                    </button>
                    </Explain>
                ))}
            </div>
            {sampleError && (
                <p role="alert" className="mt-2 text-sm text-danger">
                    {sampleError}
                </p>
            )}
        </div>
    );
};
