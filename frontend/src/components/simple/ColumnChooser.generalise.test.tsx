import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within, fireEvent } from '@testing-library/react';
import ColumnChooser from './ColumnChooser';
import { PARSE } from '../../test/pipeline-fakes';

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

describe('ColumnChooser: generalisation x keyed hash', () => {
    it('offers the generalisation policies and runs them with default parameters', () => {
        const onRun = vi.fn();
        renderChooser({ onRun });
        const select = screen.getByLabelText('Anonymisation for name');
        const values = within(select)
            .getAllByRole('option')
            .map((o) => o.getAttribute('value'));
        expect(values).toEqual(expect.arrayContaining(['year', 'age-band', 'bucket']));

        fireEvent.change(select, { target: { value: 'bucket' } });
        fireEvent.change(screen.getByLabelText('Anonymisation for joined'), {
            target: { value: 'age-band' },
        });
        fireEvent.change(screen.getByLabelText('Anonymisation for email'), {
            target: { value: 'year' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));

        const run = onRun.mock.calls[0][0];
        expect(run[0]).toEqual({ type: 'bucket' });
        expect(run[1]).toEqual({ type: 'year' });
        expect(run[2].type).toBe('age-band');
        expect(run[2].referenceDate).toMatch(/^\d{4}-01-01$/);
        expect(run[2]).not.toHaveProperty('width');
    });

    it('states the age-band reference date, only while a column uses age-band', () => {
        renderChooser();
        expect(
            screen.queryByRole('note', { name: 'Age band reference date' })
        ).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Anonymisation for joined'), {
            target: { value: 'age-band' },
        });
        const note = screen.getByRole('note', { name: 'Age band reference date' });
        expect(note).toHaveTextContent(/as of \d{4}-01-01/);
        expect(note).toHaveTextContent('[REDACTED]');

        fireEvent.change(screen.getByLabelText('Anonymisation for joined'), {
            target: { value: 'keep' },
        });
        expect(
            screen.queryByRole('note', { name: 'Age band reference date' })
        ).not.toBeInTheDocument();
    });

    it('offers every Simple policy together and keeps keying on the per-run hash', () => {
        const onRun = vi.fn();
        renderChooser({ onRun });
        const select = screen.getByLabelText('Anonymisation for name');
        const values = within(select)
            .getAllByRole('option')
            .map((o) => o.getAttribute('value'));
        expect(values).toEqual([
            'keep', 'redact', 'mask', 'mask-email', 'mask-last4',
            'hash-run', 'hash', 'faux', 'year', 'age-band', 'bucket',
        ]);

        fireEvent.change(select, { target: { value: 'hash-run' } });
        fireEvent.change(screen.getByLabelText('Anonymisation for joined'), {
            target: { value: 'age-band' },
        });
        expect(screen.getByRole('note', { name: 'Keyed per-run hash note' })).toBeInTheDocument();
        expect(screen.getByRole('note', { name: 'Age band reference date' })).toBeInTheDocument();
        expect(screen.queryByRole('note', { name: 'Unkeyed hash warning' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));
        const run = onRun.mock.calls[0][0];
        expect(run[0]).toEqual({ type: 'hash', keying: 'run' });
        expect(run[2].type).toBe('age-band');
    });
});
