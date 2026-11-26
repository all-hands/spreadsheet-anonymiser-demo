import * as Comlink from 'comlink';
import { anonymizeData, decryptData } from './anonymize';
import { measureAnonymity, suppressForRelease } from './anonymity';
import { atRiskRows, planAnonymity } from './anonymity-plan';
import { generateFile } from './generate';
import { parseFile } from './parse';
import { cancelStream, streamAnonymize } from './stream';
import { endSession, startSession } from './session';

Comlink.expose({
    parseFile,
    anonymizeData,
    decryptData,
    generateFile,
    measureAnonymity,
    suppressForRelease,
    planAnonymity,
    atRiskRows,
    streamAnonymize,
    cancelStream,
    startSession,
    endSession,
});
