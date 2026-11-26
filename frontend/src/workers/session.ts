import { ensureWasm, generate_salt, session_from_passphrase } from './wasm';
import type { Session } from './wasm';

let session: Session | null = null;
let sessionPassphrase: Uint8Array | null = null;

export const startSession = async (
    passphrase: string,
    onProgress: (msg: string) => void = () => {}
): Promise<Uint8Array> => {
    await ensureWasm();
    if (!passphrase) throw new Error('passphrase required');
    onProgress('Deriving key (Argon2id, ~1s)...');
    const salt = generate_salt();
    session = session_from_passphrase(passphrase, salt, 'browser');
    sessionPassphrase = new TextEncoder().encode(passphrase);
    onProgress('Keyed session active. Hash policy now uses keyed BLAKE2-512.');
    return salt;
};

export const endSession = () => {
    (session as { free?: () => void } | null)?.free?.();
    session = null;
    sessionPassphrase?.fill(0);
    sessionPassphrase = null;
};

export const currentSession = (): Session | null => session;
export const passphraseBytes = (): Uint8Array | null => sessionPassphrase;
