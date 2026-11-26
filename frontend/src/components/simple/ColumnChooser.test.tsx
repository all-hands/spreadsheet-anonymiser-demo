import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within, fireEvent } from '@testing-library/react';
import ColumnChooser from './ColumnChooser';
import { seedChooserPolicies } from './chooser-policies';
import { PARSE } from '../../test/pipeline-fakes';
import { BASIC_POLICY_OPTIONS } from '../../types/policy';
import type { ColumnMetadata } from '../../types/data';

const renderChooser = (props: Partial<Parameters<typeof ColumnChooser>[0]> = {}) =>
    render(
        <MemoryRouter>
            <ColumnChooser
                headers={PARSE.headers}
                metadata={PARSE.metadata}
                rows={PARSE.data}
                onRun={vi.fn()}
                {...props}
            />
        </MemoryRouter>
    );

const columnRows = () =>
    within(screen.getByRole('table'))
        .getAllByRole('row')
        .slice(1);

const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');

describe('seedChooserPolicies', () => {
    it('is dense and follows the role heuristics: identifiers redact, dates -> year', () => {
        expect(seedChooserPolicies(PARSE.metadata, PARSE.data)).toEqual({
            0: { type: 'redact' },
            1: { type: 'redact' },
            2: { type: 'year' },
        });
    });

    const meta = (header: string, type: ColumnMetadata['type'], index = 0): ColumnMetadata => ({
        index, header, type, confidence: 1,
    });

    it('seeds a date column as year, never mask (ISO dates are not phone numbers)', () => {
        const rows = [['1980-12-11'], ['2024-01-01']];
        expect(seedChooserPolicies([meta('dob', 'date')], rows)[0]).toEqual({ type: 'year' });
        expect(seedChooserPolicies([meta('signup_date', 'date')], rows)[0]).toEqual({ type: 'year' });
    });

    it('redacts a date column the year policy cannot read (not year-first)', () => {
        const rows = [['11/12/1980'], ['01/01/2024']];
        expect(seedChooserPolicies([meta('visit_date', 'date')], rows)[0]).toEqual({ type: 'redact' });
    });

    it('agrees with Advanced: names and ids redact; salary and diagnosis stay on keep', () => {
        const metadata = ['patient_id', 'first_name', 'bank_sort_code', 'salary', 'diagnosis', 'plan'].map((h, i) =>
            meta(h, 'text', i)
        );
        const rows = [['P-1', 'Ann', '12-34-56', '53000', 'Migraine', 'standard']];
        const types = Object.values(seedChooserPolicies(metadata, rows)).map((p) => p.type);
        expect(types).toEqual(['redact', 'redact', 'redact', 'keep', 'keep', 'keep']);
    });

    it('never seeds keep for a direct-identifier column under a sensitive or quasi header', () => {
        const metadata = [meta('health_contact', 'email', 0), meta('team_phone', 'phone', 1), meta('diagnosis', 'text', 2)];
        const rows = [['a.client@nhs-example.org', '+44 20 7946 0000', 'Migraine']];
        const types = Object.values(seedChooserPolicies(metadata, rows)).map((p) => p.type);
        expect(types[0]).toBe('mask');
        expect(types[1]).toBe('mask');
        expect(types[2]).toBe('keep');
    });

    it('seeds a numeric quasi-identifier as a range, and only ever uses basic policies', () => {
        const rows = [['34'], ['58']];
        const p = seedChooserPolicies([meta('age', 'text')], rows);
        expect(p[0]).toEqual({ type: 'bucket' });
        expect(BASIC_POLICY_OPTIONS.map((o) => o.type)).toContain(p[0].type);
        expect(seedChooserPolicies([meta('city', 'text')], [['Leeds']])[0]).toEqual({ type: 'keep' });
    });
});

describe('ColumnChooser', () => {
    it('renders one row per column with header, detected type and sample values', () => {
        renderChooser();

        const rows = columnRows();
        expect(rows).toHaveLength(PARSE.headers.length);

        const [name, email, joined] = rows.map((row) => cellsOf(row));
        expect(name[0]).toHaveTextContent('name');
        expect(name[1]).toHaveTextContent('text');
        expect(name[2]).toHaveTextContent('Ann, Bo');

        expect(email[0]).toHaveTextContent('email');
        expect(email[1]).toHaveTextContent('email');
        expect(email[2]).toHaveTextContent('a@x.com, b@x.com');

        expect(joined[0]).toHaveTextContent('joined');
        expect(joined[1]).toHaveTextContent('date');
        expect(joined[2]).toHaveTextContent('2024-01-01, 2024-02-02');
    });

    it('seeds selectors from the role heuristics: name/email -> redact, date -> year', () => {
        renderChooser();

        const rows = columnRows();
        expect(within(rows[0]).getByRole('combobox')).toHaveValue('redact');
        expect(within(rows[1]).getByRole('combobox')).toHaveValue('redact');
        expect(within(rows[2]).getByRole('combobox')).toHaveValue('year');
    });

    it('offers exactly the basic options — no encrypt, no kyber-aes, no legacy', () => {
        renderChooser();

        const select = screen.getByLabelText('Anonymisation for name');
        const values = within(select)
            .getAllByRole('option')
            .map((o) => o.getAttribute('value'));
        expect(values).toEqual(
            BASIC_POLICY_OPTIONS.flatMap((o) => (o.type === 'hash' ? ['hash-run', 'hash'] : [o.type]))
        );
        expect(values).not.toContain('encrypt');
        expect(values).not.toContain('kyber-aes');
    });

    it('runs with the dense record reflecting a changed select', () => {
        const onRun = vi.fn();
        renderChooser({ onRun });

        fireEvent.change(screen.getByLabelText('Anonymisation for joined'), {
            target: { value: 'mask' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));

        expect(onRun).toHaveBeenCalledTimes(1);
        expect(onRun).toHaveBeenCalledWith({
            0: { type: 'redact' },
            1: { type: 'redact' },
            2: { type: 'mask' },
        });
    });

    it('counts non-keep entries in the summary line', () => {
        renderChooser();
        expect(screen.getByText('3 of 3 columns will be transformed')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Anonymisation for name'), {
            target: { value: 'keep' },
        });
        expect(screen.getByText('2 of 3 columns will be transformed')).toBeInTheDocument();
    });

    it('marks empty sample cells instead of rendering "null"/"undefined"', () => {
        renderChooser({ rows: [['Ann', 'a@x.com', '2024-01-01'], [null, null, null]] });

        const [name] = columnRows().map((row) => cellsOf(row));
        expect(name[2]).toHaveTextContent('Ann, —');
        expect(name[2]).not.toHaveTextContent('null');
    });

    it('disables the action while a run is in flight', () => {
        renderChooser({ disabled: true });
        expect(screen.getByRole('button', { name: 'Anonymise & download' })).toBeDisabled();
    });

    it('labels hash as unkeyed in Simple mode', () => {
        renderChooser();
        const select = screen.getByLabelText('Anonymisation for name');
        expect(within(select).getByRole('option', { name: 'Hash (unkeyed)' })).toHaveValue('hash');
    });

    it('warns about unkeyed hashing only while a column is set to hash', () => {
        renderChooser();
        expect(screen.queryByRole('note', { name: 'Unkeyed hash warning' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Anonymisation for name'), {
            target: { value: 'hash' },
        });
        const note = screen.getByRole('note', { name: 'Unkeyed hash warning' });
        expect(note).toHaveTextContent('Unkeyed hash');
        expect(within(note).getByRole('link', { name: 'Advanced mode' })).toHaveAttribute('href', '/advanced');

        fireEvent.change(screen.getByLabelText('Anonymisation for name'), {
            target: { value: 'keep' },
        });
        expect(screen.queryByRole('note', { name: 'Unkeyed hash warning' })).not.toBeInTheDocument();
    });

    it('offers the keyed per-run hash first among the hash options, unkeyed still available', () => {
        renderChooser();
        const select = screen.getByLabelText('Anonymisation for name');
        const options = within(select).getAllByRole('option');
        const labels = options.map((o) => o.textContent);
        expect(labels).toContain('Hash (keyed, this run only)');
        expect(labels).toContain('Hash (unkeyed)');
        expect(labels.indexOf('Hash (keyed, this run only)')).toBeLessThan(
            labels.indexOf('Hash (unkeyed)')
        );
    });

    it('the keyed option sends {type: hash, keying: run} and shows its hint, not the unkeyed warning', () => {
        const onRun = vi.fn();
        renderChooser({ onRun });

        fireEvent.change(screen.getByLabelText('Anonymisation for name'), {
            target: { value: 'hash-run' },
        });
        expect(screen.getByLabelText('Anonymisation for name')).toHaveValue('hash-run');
        expect(screen.queryByRole('note', { name: 'Unkeyed hash warning' })).not.toBeInTheDocument();
        const hint = screen.getByRole('note', { name: 'Keyed per-run hash note' });
        expect(hint).toHaveTextContent(/this run only/i);
        expect(hint).toHaveTextContent(/not match tokens from any other run/i);
        expect(screen.getByText('3 of 3 columns will be transformed')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));
        expect(onRun).toHaveBeenCalledWith({
            0: { type: 'hash', keying: 'run' },
            1: { type: 'redact' },
            2: { type: 'year' },
        });
    });

    it('shows each note only while its option is selected; both when mixed', () => {
        renderChooser();
        const keyed = () => screen.queryByRole('note', { name: 'Keyed per-run hash note' });
        const unkeyed = () => screen.queryByRole('note', { name: 'Unkeyed hash warning' });
        expect(keyed()).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Anonymisation for name'), { target: { value: 'hash-run' } });
        fireEvent.change(screen.getByLabelText('Anonymisation for email'), { target: { value: 'hash' } });
        expect(keyed()).toBeInTheDocument();
        expect(unkeyed()).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Anonymisation for email'), { target: { value: 'mask' } });
        expect(keyed()).toBeInTheDocument();
        expect(unkeyed()).not.toBeInTheDocument();
    });

    it('keeps the seeded defaults key-free: nothing is hashed until the user picks it', () => {
        renderChooser();
        const values = columnRows().map((r) => (within(r).getByRole('combobox') as HTMLSelectElement).value);
        expect(values).not.toContain('hash');
        expect(values).not.toContain('hash-run');
    });
});
