import { currentSession, passphraseBytes } from './session';
import { deriveRunKeys } from './run-keys';
import type { RunKeys } from './run-keys';
import {
    ensureWasm,
    apply_policy,
    apply_policy_keyed_typed,
    apply_policy_generalised,
    apply_policy_legacy,
    reencode_token_str,
    decrypt_any_value,
    is_encrypted_value,
    policy_key_material,
} from './wasm';
import type { AnonymizeResult, ColumnMetadata, Rows } from '../types/data';
import { isGeneralisation, KEYED_SESSION_REQUIRED, toKeyMaterial } from '../types/policy';
import type { AnonymizeOpts, ColumnPolicy, PolicyKeyMaterial, PolicyType } from '../types/policy';

const TOKEN_BYTES = 16;

export const activeColumns = (policies: Record<number, ColumnPolicy>): number[] =>
    Object.keys(policies)
        .map(Number)
        .filter((i) => policies[i].type !== 'keep');

export const deriveSessionColumnKeys = (
    policies: Record<number, ColumnPolicy>,
    headers: string[],
    dataset: string | undefined,
    runKeys: Map<number, Uint8Array>
): Map<number, Uint8Array> => {
    const keys = new Map<number, Uint8Array>();
    const session = currentSession();
    if (!session) return keys;
    try {
        for (const idx of activeColumns(policies)) {
            if (runKeys.has(idx) || (policy_key_material(policies[idx].type) as PolicyKeyMaterial) !== 'column') continue;
            const name = headers[idx] ?? String(idx);
            keys.set(idx, dataset ? session.column_key_scoped(dataset, name) : session.column_key(name));
        }
    } catch (err) {
        keys.forEach((k) => k.fill(0));
        throw err;
    }
    return keys;
};

export const anonymizeData = async (
    data: Rows,
    headers: string[],
    metadata: ColumnMetadata[],
    policies: Record<number, ColumnPolicy>,
    onProgress: (msg: string) => void = () => {},
    opts: AnonymizeOpts = {},
    shared?: RunKeys,
    keysPinned = false
): Promise<AnonymizeResult> => {
    await ensureWasm();
    const runKeys = shared ?? deriveRunKeys(activeColumns(policies), policies, headers);
    let sessionKeys = new Map<number, Uint8Array>();
    try {
        if (!keysPinned) sessionKeys = deriveSessionColumnKeys(policies, headers, opts.dataset, runKeys.keys);
        const colKeys = new Map<number, Uint8Array>(runKeys.keys);
        sessionKeys.forEach((k, i) => colKeys.set(i, k));
        const keyed = keysPinned ? colKeys.size > 0 : !!currentSession() || runKeys.keys.size > 0;
        return await anonymizeWith(data, headers, metadata, policies, onProgress, opts, colKeys, keyed);
    } finally {
        sessionKeys.forEach((k) => k.fill(0));
        if (!shared) runKeys.release();
    }
};

const anonymizeWith = async (
    data: Rows,
    _headers: string[],
    _metadata: ColumnMetadata[],
    policies: Record<number, ColumnPolicy>,
    onProgress: (msg: string) => void,
    opts: AnonymizeOpts,
    colKeys: Map<number, Uint8Array>,
    keyed: boolean
): Promise<AnonymizeResult> => {
    onProgress('Starting anonymisation...');

    const processIndices = Object.keys(policies).map(Number).filter(idx => {
        const p = policies[idx].type;
        return p !== 'keep';
    });

    if (processIndices.length === 0) {
        onProgress('No columns to anonymise.');
        return { data, counts: {} };
    }

    const material = new Map<PolicyType, PolicyKeyMaterial>();
    const materialOf = (t: PolicyType): PolicyKeyMaterial => {
        let m = material.get(t);
        if (!m) {
            m = toKeyMaterial(policy_key_material(t));
            material.set(t, m);
        }
        return m;
    };
    for (const idx of processIndices) {
        if (materialOf(policies[idx].type) === 'passphrase' && !passphraseBytes()) {
            throw new Error(
                `policy "${policies[idx].type}" keys on the passphrase (the old app's ` +
                'global key) — start a keyed session first'
            );
        }
    }

    for (const idx of processIndices) {
        if (policies[idx].type === 'encrypt' && !colKeys.has(idx)) {
            throw new Error(KEYED_SESSION_REQUIRED);
        }
    }

    const counts: Record<number, number> = {};
    const totalRows = data.length;
    const newData = data.map((row, rowIndex) => {
        if (rowIndex % 1000 === 0) onProgress(`Anonymising row ${rowIndex}/${totalRows}`);

        return row.map((cell, colIndex) => {
            const policy = policies[colIndex];
            if (!policy || policy.type === 'keep') return cell;

            const strVal = String(cell);
            if (strVal === '') return cell;

            counts[colIndex] = (counts[colIndex] ?? 0) + 1;
            const key = colKeys.get(colIndex);
            if (isGeneralisation(policy.type)) {
                return apply_policy_generalised(
                    strVal,
                    policy.type,
                    policy.width,
                    policy.referenceDate || undefined
                );
            }
            if (materialOf(policy.type) === 'passphrase') {
                return apply_policy_legacy(strVal, policy.type, passphraseBytes()!);
            }
            return key
                ? apply_policy_keyed_typed(
                      strVal,
                      policy.type,
                      key,
                      TOKEN_BYTES,
                      policy.canon ?? 'auto'
                  )
                : apply_policy(strVal, policy.type);
        });
    });

    if (opts.tokenEncoding === 'base32') {
        for (const idx of processIndices) {
            if (policies[idx].type !== 'hash' || !colKeys.has(idx)) continue;
            for (const row of newData) {
                const cell = row[idx];
                if (typeof cell === 'string' && cell !== '') {
                    row[idx] = reencode_token_str(cell, 'hash', 'base32');
                }
            }
        }
    }

    onProgress(keyed ? 'Anonymisation complete (keyed).' : 'Anonymisation complete.');
    return { data: newData, counts };
};

export const decryptData = async (
    data: Rows,
    headers: string[],
    onProgress: (msg: string) => void = () => {},
    opts: AnonymizeOpts = {}
): Promise<{ data: Rows; decrypted: number }> => {
    await ensureWasm();
    const sess = currentSession();
    if (!sess) throw new Error('Decryption requires a keyed session (passphrase).');

    onProgress('Deriving column keys...');
    const keys = headers.map((h) =>
        opts.dataset ? sess.column_key_scoped(opts.dataset, h) : sess.column_key(h)
    );

    const legacyKey = passphraseBytes();
    let decrypted = 0;
    const totalRows = data.length;
    const newData = data.map((row, rowIndex) => {
        if (rowIndex % 1000 === 0) onProgress(`Decrypting row ${rowIndex}/${totalRows}`);
        return row.map((cell, colIndex) => {
            const strVal = String(cell);
            if (!is_encrypted_value(strVal)) return cell;
            decrypted++;
            return decrypt_any_value(strVal, keys[colIndex] ?? null, legacyKey);
        });
    });

    onProgress(`Decrypted ${decrypted} cells.`);
    return { data: newData, decrypted };
};
