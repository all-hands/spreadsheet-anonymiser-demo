import { readOds, writeOds } from 'hucre/ods';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Cell, Rows } from '../types/data';
import { MAX_XLSX_ENTRY_BYTES } from '../lib/constants';
import { SHEET_NAME, sheetRowsOf, type SheetRows } from './sheet-rows';

export const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';

const CONTENT = 'content.xml';
const MANIFEST = 'META-INF/manifest.xml';

const EPOCH_MS = Date.UTC(1899, 11, 30);

const DURATION = /^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/;

const timeToIso = (duration: string): string | null => {
    const m = DURATION.exec(duration);
    if (!m) return null;
    const [, sign, d, h, min, s] = m;
    const seconds =
        Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number((s ?? '0').replace(',', '.'));
    const date = new Date(EPOCH_MS + (sign ? -1 : 1) * Math.round(seconds * 1000));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const TOKENS =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?(?:[\w.-]+:)?(?:table-header-rows|table-row-group|table-rows)(?=[\s/>])[^>]*>|<(?:[\w.-]+:)?table-cell\s(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
const CONTAINER = /^<\/?(?:[\w.-]+:)?(?:table-header-rows|table-row-group|table-rows)(?=[\s/>])/;
const TIME_TYPE = /(\s(?:office|calcext):value-type\s*=\s*["'])time(["'])/g;
const TIME_VALUE = /\soffice:time-value\s*=\s*["']([^"']*)["']/;

export const normaliseContent = (xml: string): string =>
    xml.replace(TOKENS, (token) => {
        if (token.startsWith('<!')) return token;
        if (CONTAINER.test(token)) return '';
        const iso = timeToIso(TIME_VALUE.exec(token)?.[1] ?? '');
        if (iso === null || token.search(TIME_TYPE) < 0) return token;
        return token.replace(TIME_TYPE, '$1date$2').replace(TIME_VALUE, ` office:date-value="${iso}"`);
    });

export const readFirstOdsSheet = async (buffer: ArrayBuffer): Promise<SheetRows> => {
    const parts = unzipSync(new Uint8Array(buffer), {
        filter: ({ name, originalSize }) => {
            if (name !== CONTENT && name !== MANIFEST && name !== 'mimetype') return false;
            if (originalSize > MAX_XLSX_ENTRY_BYTES) throw new Error(`${name} is too large when decompressed.`);
            return true;
        },
    });
    if (parts[MANIFEST] && /[<:]encryption-data[\s>]/.test(strFromU8(parts[MANIFEST]))) {
        throw new Error('the file is password-protected. Save it without a password and try again.');
    }
    if (!parts.mimetype || !strFromU8(parts.mimetype).trim().startsWith(ODS_MIME)) {
        throw new Error('not an OpenDocument spreadsheet.');
    }
    if (!parts[CONTENT]) throw new Error(`missing ${CONTENT}.`);
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(parts[CONTENT]);
    const repacked = zipSync({ mimetype: parts.mimetype, [CONTENT]: strToU8(normaliseContent(xml)) }, { level: 0 });
    const workbook = await readOds(repacked, {
        sheets: (_info, index) => index === 0,
        maxDecompressedBytes: MAX_XLSX_ENTRY_BYTES,
    });
    const sheet = workbook.sheets[0];
    if (!sheet) throw new Error('No sheets found');
    return sheetRowsOf(sheet.rows, (d) => (Number.isNaN(d.getTime()) ? null : d.toISOString()));
};

const odfText = (text: string): string =>
    text
        .replace(/^ +| +$| {2,}/g, (run) => `<text:s text:c="${run.length}"/>`)
        .replace(/\t/g, '<text:tab/>')
        .replace(/(?:\r|&#13;|&#x0?D;)?(?:\n|&#10;|&#x0?A;)|\r|&#13;|&#x0?D;/gi, '<text:line-break/>');

export const writeOdsSheet = async (headers: string[], data: Rows): Promise<Blob> => {
    const rows: Cell[][] = [headers, ...data];
    const parts = unzipSync(await writeOds({ sheets: [{ name: SHEET_NAME, rows }] }));
    const xml = strFromU8(parts[CONTENT]).replace(
        /<text:p>([^<]+)<\/text:p>/g,
        (_p, text: string) => `<text:p>${odfText(text)}</text:p>`,
    );
    const { mimetype, ...rest } = parts;
    const out: Zippable = { mimetype: [mimetype, { level: 0 }], ...rest, [CONTENT]: strToU8(xml) };
    return new Blob([zipSync(out, { level: 6 }) as BlobPart], { type: ODS_MIME });
};
