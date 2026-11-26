import { toArtifact } from './download';
import type { Artifact } from './download';
import type { AuditSink, RunInput } from './pipeline';

export const supportingArtifacts = (input: RunInput, audit: AuditSink): Artifact[] => {
    const artifacts: Artifact[] = [];
    if (input.salt) {
        artifacts.push(
            toArtifact(new Blob([input.salt.slice()]), `anonymized-${input.file.name}.salt`)
        );
    }
    const log = audit.getLog();
    if (log) {
        artifacts.push(
            toArtifact(
                new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }),
                input.file.name.replace(/\.(csv|tsv|tab|jsonl|ndjson|xlsx|ods)$/i, '') + '_audit.json'
            )
        );
    }
    return artifacts;
};
