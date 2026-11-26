import { anonymityStatement } from './anonymity';
import type { SuppressMode } from '../types/anonymity';

export const PSEUDONYMISED_LINE =
    'Output is pseudonymised, not anonymous. Treat it as personal data under GDPR.';

export const PSEUDONYMISED_DETAIL =
    'Hashed, encrypted and faux columns can still be linked back to people, ' +
    'and kept columns are not changed at all.';

export interface PassedAnonymity {
    k: number;
    mode: SuppressMode;
    quasiIdentifiers: string[];
}

export interface Notice {
    variant: 'pseudonymised' | 'k-anonymity';
    line: string;
    detail: string;
}

export const K_ANONYMITY_LIMITS =
    'It says nothing about linkage with other datasets, free-text columns, sensitive-value ' +
    'diversity or small files, and columns not listed are not covered. Whether the data is ' +
    'anonymous in law (GDPR recital 26) is your assessment, not this check. No salt file or ' +
    'mapping was produced for this output.';

export const noticeFor = (anonymity?: PassedAnonymity | null): Notice =>
    anonymity
        ? {
              variant: 'k-anonymity',
              line:
                  `${anonymityStatement(anonymity.k, anonymity.mode)} on ` +
                  `${anonymity.quasiIdentifiers.join(', ')}. This is a statistical check on this file ` +
                  'only, not a finding that the data is anonymous.',
              detail: K_ANONYMITY_LIMITS,
          }
        : { variant: 'pseudonymised', line: PSEUDONYMISED_LINE, detail: PSEUDONYMISED_DETAIL };
