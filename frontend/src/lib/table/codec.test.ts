// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const freed = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../workers/wasm', async () => {
    const real = (await import('./test-wasm')).realTableCodec();
    class TableDecoder extends real.TableDecoder {
        free() {
            freed.count++;
            super.free();
        }
    }
    return { ...real, TableDecoder };
});

import { createRowDecoder, encodeHeader, encodeRows } from './codec';
import type { TextTableFormat } from './codec';

const all = (format: TextTableFormat, text: string) => {
    const d = createRowDecoder(format).push(text, true);
    return { headers: d.headers, rows: d.rows };
};

const sliced = (format: TextTableFormat, text: string, size: number) => {
    const dec = createRowDecoder(format);
    let headers: string[] | null = null;
    const rows: string[][] = [];
    for (let i = 0; i <= text.length; i += size) {
        const last = i + size > text.length;
        const d = dec.push(text.slice(i, i + size), last);
        if (d.headers) {
            expect(headers).toBeNull();
            headers = d.headers;
        }
        rows.push(...d.rows);
    }
    return { headers, rows };
};

describe('row decoder (delimited)', () => {
    it('strips a BOM on the first header and separates header from rows', () => {
        expect(all('csv', '﻿id,name\n1,Ann\n')).toEqual({ headers: ['id', 'name'], rows: [['1', 'Ann']] });
    });

    it('announces headers exactly once across pushes', () => {
        const dec = createRowDecoder('csv');
        const a = dec.push('id,na', false);
        const b = dec.push('me\n1,Ann\n2,Bo\n', false);
        const c = dec.push('', true);
        expect(a.headers).toBeNull();
        expect(b.headers).toEqual(['id', 'name']);
        expect(c.headers).toBeNull();
        expect([...a.rows, ...b.rows, ...c.rows]).toEqual([['1', 'Ann'], ['2', 'Bo']]);
    });

    it('yields identical rows for every slicing, surrogate pairs included', () => {
        const text = 'h1,h2,h3\r\n"a,""x""\r\nb",c,😀\r\n\r\n,"",\n"ué",,\r\nx,y,"unterminated 😀';
        const whole = all('csv', text);
        expect(whole.rows).toHaveLength(4);
        for (let size = 1; size <= text.length; size++) expect(sliced('csv', text, size)).toEqual(whole);
    });

    it('splits a large push into bounded crossings without changing the rows', () => {
        const row = '"q""uote",😀,' + 'x'.repeat(997) + '\n';
        const text = 'a,b,c\n' + row.repeat(3000);
        const { rows } = all('csv', text);
        expect(rows).toHaveLength(3000);
        expect(rows[2999]).toEqual(['q"uote', '😀', 'x'.repeat(997)]);
    });

    it('rejects ragged rows with a message that carries no data', () => {
        expect(() => all('csv', 'a,b\nSECRET,2,3\n')).toThrow(
            'CSV record 1 (line 2): found 3 fields, but the header has 2'
        );
        expect(() => all('tsv', 'a\tb\nSECRET\n')).toThrow(/^TSV record 1 \(line 2\): found 1 fields/);
    });

    it('keeps the BOM handling of the CLI when the text keeps its BOM', () => {
        expect(all('csv', '﻿"a,x",b\n1,2\n').headers).toEqual(['a,x', 'b']);
        expect(all('csv', '﻿﻿﻿a,b\n1,2\n').headers).toEqual(['﻿a', 'b']);
    });

    it('has no header set for an empty or blank file', () => {
        expect(all('csv', '')).toEqual({ headers: null, rows: [] });
        expect(all('csv', '\n\r\n')).toEqual({ headers: null, rows: [] });
    });
});

describe('row decoder (JSONL)', () => {
    it('orders columns by sorted key, not file order, and reads missing keys as empty', () => {
        expect(all('jsonl', '{"b":1,"a":"x"}\n{"b":2}\n')).toEqual({
            headers: ['a', 'b'],
            rows: [['x', '1'], ['', '2']],
        });
    });

    it('stringifies scalars like the CLI and skips blank lines', () => {
        expect(all('jsonl', '{"n":null,"t":true,"f":false,"s":"\\u00e9\\n","x":1.0}\n\n  \n').rows).toEqual([
            ['false', '', 'é\n', 'true', '1.0'],
        ]);
    });

    it('prints numbers exactly as the CLI (serde_json) does', () => {
        const cases: [string, string][] = [
            ['12345678901234567.0', '1.2345678901234566e+16'], ['1e16', '1e+16'], ['1e-7', '1e-7'],
            ['18446744073709551616', '1.8446744073709552e+19'], ['-0', '-0.0'], ['10.50', '10.5'],
        ];
        for (const [lexeme, printed] of cases) {
            expect(all('jsonl', `{"a":${lexeme}}`).rows).toEqual([[printed]]);
        }
        expect(() => all('jsonl', '{"a":1E400}')).toThrow(/out of range/);
    });

    it('rejects nested values, unknown later keys and bad JSON without echoing data', () => {
        expect(() => all('jsonl', '{"a":[1]}')).toThrow(/nested/);
        expect(() => all('jsonl', '{"a":{"b":1}}')).toThrow(/nested/);
        expect(() => all('jsonl', '{"a":1}\n{"a":1,"zz":2}')).toThrow(/not in the header set.*silently drop/);
        expect(() => all('jsonl', '{"a":1}\nnot json SECRET')).toThrow(/line 2/);
        for (const bad of ['{"a":1}\nnot json SECRET', '{"a":1}\n{"a":1,"SECRET":2}', '{"a":1}\n"SECRET"']) {
            expect(() => all('jsonl', bad)).toThrow(/^JSONL line 2: /);
            try {
                all('jsonl', bad);
            } catch (e) {
                expect((e as Error).message).not.toMatch(/SECRET/);
            }
        }
    });

    it('handles a line split across pushes and CRLF endings', () => {
        const dec = createRowDecoder('jsonl');
        const a = dec.push('{"a":"x"', false);
        const b = dec.push('}\r\n{"a":"y"}', false);
        const c = dec.push('', true);
        expect(a.rows).toEqual([]);
        expect([...b.rows, ...c.rows]).toEqual([['x'], ['y']]);
    });

    it('a blank-only input has no header set', () => {
        expect(all('jsonl', '  ')).toEqual({ headers: null, rows: [] });
    });

    it('drops one leading BOM (TextDecoder keeps it), however the text is sliced', () => {
        const text = '﻿{"a":"😀"}\n{"a":"y"}';
        const whole = all('jsonl', text);
        expect(whole).toEqual({ headers: ['a'], rows: [['😀'], ['y']] });
        for (let size = 1; size <= text.length; size++) expect(sliced('jsonl', text, size)).toEqual(whole);
        const dec = createRowDecoder('jsonl');
        dec.push('', false);
        expect(dec.push(text, true).rows).toHaveLength(2);
        expect(() => all('jsonl', '﻿﻿{"a":1}')).toThrow(/^JSONL line 1: invalid JSON/);
    });
});

describe('decoder lifetime', () => {
    it('frees the wasm decoder on the final push, on error and on free(), exactly once', () => {
        freed.count = 0;
        createRowDecoder('csv').push('a\n1\n', true);
        expect(freed.count).toBe(1);

        const failing = createRowDecoder('csv');
        expect(() => failing.push('a,b\n1\n', false)).toThrow();
        expect(freed.count).toBe(2);
        failing.free();
        expect(freed.count).toBe(2);
        expect(() => failing.push('x', true)).toThrow(/closed/);

        const early = createRowDecoder('jsonl');
        early.push('{"a":1}\n', false);
        early.free();
        early.free();
        expect(freed.count).toBe(3);
    });
});

const utf8 = new TextDecoder();
const rowsText = (...args: Parameters<typeof encodeRows>): string =>
    encodeRows(...args).map((b) => utf8.decode(b)).join('');
const headerText = (...args: Parameters<typeof encodeHeader>): string => utf8.decode(encodeHeader(...args));

describe('encoder', () => {
    it('quotes only when needed and ends with \\n', () => {
        const h = ['1', '2', '3', '4', '5', '6'];
        expect(rowsText('csv', h, [['a', 'b,c', 'd"e', 'f\ng', 'h\ri', ' j ']])).toBe(
            'a,"b,c","d""e","f\ng","h\ri", j \n'
        );
    });

    it('quotes a record that is a single empty field', () => {
        expect(rowsText('csv', ['a'], [['']])).toBe('""\n');
        expect(rowsText('csv', ['a', 'b'], [['', '']])).toBe(',\n');
    });

    it('uses the tab as the TSV delimiter and does not quote commas there', () => {
        expect(rowsText('tsv', ['a', 'b'], [['a,b', 'c\td']])).toBe('a,b\t"c\td"\n');
        expect(headerText('tsv', ['a', 'b'])).toBe('a\tb\n');
    });

    it('round-trips through encode (null cells become empty, others String(v))', () => {
        const text = headerText('csv', ['a', 'b']) + rowsText('csv', ['a', 'b'], [['x,y', null], [1, true]]);
        expect(text).toBe('a,b\n"x,y",\n1,true\n');
    });

    it('writes JSONL keys in header order with every value as a JSON string', () => {
        expect(headerText('jsonl', ['a', 'b'])).toBe('');
        expect(rowsText('jsonl', ['a', 'b'], [['x"\\\n', '']])).toBe('{"a":"x\\"\\\\\\n","b":""}\n');
    });

    it('encodes in bounded batches of byte chunks', () => {
        expect(encodeRows('csv', ['a', 'b'], Array.from({ length: 10_000 }, () => ['x', 'y']))).toHaveLength(3);
        const rows = Array.from({ length: 10_000 }, (_, i) => [`r${i}`, i % 3 ? 'p,q' : '']);
        const out = rowsText('csv', ['a', 'b'], rows);
        expect(out.split('\n')).toHaveLength(10_001);
        expect(out.startsWith('r0,\nr1,"p,q"\n')).toBe(true);
        expect(rowsText('csv', ['a', 'b'], [])).toBe('');
    });

    it('rejects a row of the wrong length', () => {
        expect(() => rowsText('csv', ['a', 'b'], [['x']])).toThrow(/1 cells, but the header has 2/);
    });
});
