import { useEffect, useMemo, useState } from 'react';
import { createWorker } from '../lib/worker-client';
import { optsOf } from '../lib/pipeline';
import { logFailure } from '../lib/log';
import type { ColumnMetadata, RowData } from '../types/data';
import type { ColumnPolicy, TokenEncoding } from '../types/policy';

export const NEEDS_KEY_CELL = '(needs passphrase)';

export const PREVIEW_DEBOUNCE_MS = 150;

export interface PolicyPreview {
    rows: RowData[];
    transformed: boolean;
    pending: boolean;
    error: string | null;
    lockedColumns: number[];
}

interface Settled {
    key: object;
    src: RowData[];
    rows: RowData[] | null;
    error: string | null;
}

export function usePolicyPreview(
    rows: RowData[],
    headers: string[],
    metadata: ColumnMetadata[],
    policies: Record<number, ColumnPolicy>,
    dataset: string,
    tokenEncoding: TokenEncoding,
    keyStatus?: string,
): PolicyPreview {
    const active = rows.length > 0 && Object.values(policies).some((p) => p.type !== 'keep');
    const keyed = keyStatus === 'active';
    const lockedKey = keyed
        ? ''
        : Object.entries(policies)
              .filter(([, p]) => p.type === 'encrypt')
              .map(([i]) => i)
              .join(',');
    const lockedColumns = useMemo(() => (lockedKey ? lockedKey.split(',').map(Number) : []), [lockedKey]);
    const [settled, setSettled] = useState<Settled | null>(null);
    const [token, setToken] = useState<object | null>(null);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        const mine = {};
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToken(mine);
        const timer = setTimeout(async () => {
            try {
                const runPolicies = { ...policies };
                for (const i of lockedColumns) runPolicies[i] = { type: 'keep' };
                const { data: out } = await createWorker().anonymizeData(
                    rows,
                    headers,
                    metadata,
                    runPolicies,
                    undefined,
                    optsOf({ dataset, tokenEncoding }),
                );
                const data = lockedColumns.length
                    ? out.map((r) => r.map((c, i) => (lockedColumns.includes(i) ? NEEDS_KEY_CELL : c)))
                    : out;
                if (!cancelled) setSettled({ key: mine, src: rows, rows: data, error: null });
            } catch (err) {
                if (cancelled) return;
                logFailure('Policy preview failed', err);
                setSettled({ key: mine, src: rows, rows: null, error: err instanceof Error ? err.message : String(err) });
            }
        }, PREVIEW_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [active, rows, headers, metadata, policies, dataset, tokenEncoding, keyStatus, lockedColumns]);

    if (!active) return { rows, transformed: false, pending: false, error: null, lockedColumns: [] };
    const fresh = settled !== null && settled.key === token;
    if (fresh && settled.rows) return { rows: settled.rows, transformed: true, pending: false, error: null, lockedColumns };
    const last = settled && settled.src === rows ? settled.rows : null;
    return {
        rows: fresh ? rows : (last ?? rows),
        transformed: !fresh && last !== null,
        pending: !fresh,
        error: fresh ? settled.error : null,
        lockedColumns,
    };
}
