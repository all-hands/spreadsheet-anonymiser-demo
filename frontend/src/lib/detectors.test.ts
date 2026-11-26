import { describe, expect, it } from 'vitest';

import { analyzeColumns } from './detectors';

describe('analyzeColumns', () => {
    it('detects an email column', () => {
        const meta = analyzeColumns(['contact'], [
            ['a@x.com'],
            ['bob@example.co.uk'],
            ['c_d@sub.domain.org'],
        ]);

        expect(meta[0].type).toBe('email');
        expect(meta[0].confidence).toBe(1);
    });

    it('detects a phone column', () => {
        const meta = analyzeColumns(['phone'], [
            ['+44 7700 900 123'],
            ['(161) 555-0123'],
            ['07700900456'],
        ]);

        expect(meta[0].type).toBe('phone');
        expect(meta[0].confidence).toBe(1);
    });

    it('falls through to text for name-like values (no name detector)', () => {
        const meta = analyzeColumns(['name'], [['Ann'], ['Bo'], ['Cyd']]);

        expect(meta[0].type).toBe('text');
        expect(meta[0].confidence).toBe(0);
    });

    it.each([
        ['ISO yyyy-mm-dd', ['2024-01-01', '1980-12-11', '2023-03-10']],
        ['slashed dd/mm/yyyy', ['01/02/2024', '31/12/1999', '15/06/2001']],
        ['dashed dd-mm-yyyy', ['01-02-2024', '31-12-1999', '15-06-2001']],
        ['dotted dd.mm.yyyy', ['01.02.2024', '31.12.1999', '15.06.2001']],
        ['ISO datetime', ['2024-01-01T10:00:00Z', '2024-02-02 08:30:00', '2024-03-03T00:00']],
    ])('types %s as date, not phone', (_label, cells) => {
        const meta = analyzeColumns(['when'], cells.map((c) => [c]));
        expect(meta[0].type).toBe('date');
        expect(meta[0].confidence).toBe(1);
    });

    it('still types real phone numbers as phone, and does not call digit runs dates', () => {
        const meta = analyzeColumns(['p'], [['07700900456'], ['+44 7700 900 123'], ['2024-13-45']]);
        expect(meta[0].type).toBe('phone');
    });

    it('needs a majority: a minority of detectable cells leaves the column text', () => {
        const meta = analyzeColumns(['mixed'], [
            ['a@x.com'],
            ['Ann'],
            ['Bo'],
            ['Cyd'],
        ]);

        expect(meta[0].type).toBe('text');
        expect(meta[0].confidence).toBe(0);
    });

    it('samples only the first 100 rows', () => {
        const data: string[][] = Array.from({ length: 120 }, () => ['Ann']);
        data[119] = ['a@x.com'];

        const meta = analyzeColumns(['name'], data);

        expect(meta[0].type).toBe('text');
        expect(meta[0].confidence).toBe(0);
    });

    it('classifies each column independently', () => {
        const meta = analyzeColumns(['name', 'email', 'phone'], [
            ['Ann', 'a@x.com', '+1 555 123 4567'],
            ['Bo', 'b@x.com', '07700900456'],
        ]);

        expect(meta.map((m) => m.type)).toEqual(['text', 'email', 'phone']);
        expect(meta.map((m) => m.header)).toEqual(['name', 'email', 'phone']);
        expect(meta.map((m) => m.index)).toEqual([0, 1, 2]);
    });

    describe('payment cards (shape plus Luhn checksum)', () => {
        const typeOf = (cells: string[]) => analyzeColumns(['c'], cells.map((c) => [c]))[0].type;

        it('detects well-known valid test card numbers, with and without separators', () => {
            expect(
                typeOf([
                    '4111111111111111',
                    '5500 0000 0000 0004',
                    '3782-822463-10005',
                    '4222222222222',
                ])
            ).toBe('credit-card');
        });

        it('does not classify a 16-digit ID that fails the Luhn checksum as a card', () => {
            expect(typeOf(['1234567890123456', '1234567890123457', '9999999999999999'])).toBe('phone');
            expect(typeOf(['4111111111111112'])).not.toBe('credit-card');
        });

        it('keeps the shape rule: too short or too long is not a card even if Luhn-valid', () => {
            expect(typeOf(['411111111111'])).not.toBe('credit-card');
            expect(typeOf(['41111111111111111'])).not.toBe('credit-card');
        });

        it('counts each cell on its own: a column of mostly invalid IDs stays out of credit-card', () => {
            const meta = analyzeColumns(['id'], [
                ['4111111111111111'],
                ['1234567890123456'],
                ['1234567890123457'],
            ]);
            expect(meta[0].type).toBe('phone');
        });
    });
});
