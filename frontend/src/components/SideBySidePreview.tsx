import Explain from './Explain';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PreviewTable } from './PreviewTable';
import { useDatasetStore } from '../store/datasetStore';
import { createWorker } from '../lib/worker-client';
import { optsOf } from '../lib/pipeline';
import { logFailure } from '../lib/log';
import type { RowData, ColumnMetadata } from '../types/data';
import { PREVIEW_ROW_LIMIT } from '../lib/constants';
import { clsx } from 'clsx';
import { linkScroll } from '../lib/scroll-link';

interface SideBySidePreviewProps {
    headers: string[];
    originalData: RowData[];
    metadata: ColumnMetadata[];
}

export const SideBySidePreview = ({
    headers,
    originalData,
    metadata,
}: SideBySidePreviewProps) => {
    const { policies, dataset, tokenEncoding } = useDatasetStore();
    const [previewData, setPreviewData] = useState<RowData[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const leftScroller = useRef<HTMLDivElement | null>(null);
    const rightScroller = useRef<HTMLDivElement | null>(null);

    const worker = useMemo(() => createWorker(), []);

    const previewOriginal = useMemo(() => originalData.slice(0, PREVIEW_ROW_LIMIT), [originalData]);

    const modifiedColumns = useMemo(() => {
        return Object.entries(policies)
            .filter(([, policy]) => policy.type !== 'keep')
            .map(([idx]) => parseInt(idx));
    }, [policies]);

    const processPreview = useCallback(async () => {
        if (previewOriginal.length === 0) return;

        if (modifiedColumns.length === 0) {
            setError(null);
            setPreviewData(previewOriginal);
            return;
        }

        setIsProcessing(true);
        try {
            const { data: anonymized } = await worker.anonymizeData(
                previewOriginal,
                headers,
                metadata,
                policies,
                undefined,
                optsOf({ dataset, tokenEncoding })
            );
            setError(null);
            setPreviewData(anonymized);
        } catch (err) {
            logFailure('Preview processing failed', err);
            setPreviewData([]);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsProcessing(false);
        }
    }, [previewOriginal, headers, policies, metadata, modifiedColumns.length, worker, dataset, tokenEncoding]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        processPreview();
    }, [processPreview]);

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
                <Explain k="preview.title"><h2 className="text-lg font-semibold">Side-by-Side Preview</h2></Explain>
                {isProcessing && (
                    <span className="text-xs text-info animate-pulse">
                        Processing preview...
                    </span>
                )}
            </div>

            <div className="flex gap-4 flex-1 overflow-hidden">
                <div className="flex-1 flex flex-col min-w-0">
                    <Explain k="preview.original">
                    <div className="text-sm font-medium text-muted mb-2">
                        Original Data
                    </div>
                    </Explain>
                    <PreviewTable
                        headers={headers}
                        data={previewOriginal}
                        metadata={metadata}
                        highlightColumns={modifiedColumns}
                        className="flex-1"
                        scrollerRef={leftScroller}
                        onScroll={() => linkScroll(leftScroller.current, rightScroller.current)}
                        label="Original data"
                        totalRows={originalData.length}
                    />
                </div>

                <div className="w-px self-stretch" />

                <div className="flex-1 flex flex-col min-w-0">
                    <Explain k="preview.anonymised">
                    <div className="text-sm font-medium text-muted mb-2">
                        Anonymised Preview
                    </div>
                    </Explain>
                    {error ? (
                        <div className="flex-1 flex items-center justify-center text-danger text-sm text-center px-4">
                            Preview failed: {error}
                        </div>
                    ) : (
                        <PreviewTable
                            headers={headers}
                            data={previewData}
                            metadata={metadata}
                            highlightColumns={modifiedColumns}
                            className={clsx("flex-1", isProcessing && "opacity-50")}
                            scrollerRef={rightScroller}
                            onScroll={() => linkScroll(rightScroller.current, leftScroller.current)}
                            label="Anonymised data"
                            totalRows={originalData.length}
                        />
                    )}
                </div>
            </div>

            <div className="text-xs text-muted">
                {modifiedColumns.length > 0 ? (
                    <span>
                        <span className="text-info">{modifiedColumns.length}</span> column(s) will be transformed
                    </span>
                ) : (
                    <span>No transformations applied. Modify policies to see changes.</span>
                )}
            </div>
        </div>
    );
};

export default SideBySidePreview;
