import { recordColumns } from './pipeline-audit';
import { pickSaveHandle } from './save-target';
import type { AuditSink, ParsedDataset, RunDeps, RunInput } from './pipeline';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';
import type { StreamResult } from '../types/data';

export const EXCLUSION_UNAVAILABLE =
    'Row exclusion is only available for files up to 32 MiB; this file is streamed. ' +
    'Remove the rows from the source file or use the command-line tool.';

export const runStreamedExport = async (
    input: RunInput,
    deps: RunDeps,
    parse: ParsedDataset,
    policies: Record<number, ColumnPolicy>,
    opts: AnonymizeOpts
): Promise<StreamResult> => {
    const audit: AuditSink = deps.audit;

    audit.startNewLog(input.file.name, input.file.size, 0, parse.headers.length);
    if (input.excludedRows?.size) throw new Error(EXCLUSION_UNAVAILABLE);

    const handle = await pickSaveHandle(`anonymized-${input.file.name}`);
    deps.onStatus(handle ? 'Streaming to the chosen file...' : 'Streaming...');

    if (!deps.worker.streamAnonymize) throw new Error('This worker cannot stream.');
    const result = await deps.worker.streamAnonymize(
        input.file,
        policies,
        opts,
        handle,
        deps.onProgress ? (p) => deps.onProgress?.(p) : undefined
    );

    audit.startNewLog(
        input.file.name,
        input.file.size,
        result.totalRows,
        parse.headers.length,
        result.fileHash
    );
    recordColumns(audit, parse.headers, policies, result.counts);
    audit.completeLog();
    return result;
};
