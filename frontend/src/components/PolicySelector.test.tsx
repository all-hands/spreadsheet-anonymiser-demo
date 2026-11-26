import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PolicySelector from './PolicySelector';
import { useDatasetStore } from '../store/datasetStore';
import { DEPRECATED_POLICY_STRINGS, POLICY_STRINGS } from '../types/policy';

const renderSelector = () => render(<PolicySelector colIndex={0} header="dob" />);
const policy = () => useDatasetStore.getState().policies[0];

beforeEach(() => {
    useDatasetStore.setState({ policies: { 0: { type: 'keep' } } });
});

describe('PolicySelector — deprecated policies', () => {
    it('offers every recognised policy except kyber-aes, including the legacy qenc: format', () => {
        renderSelector();
        const values = [...screen.getByLabelText('Policy for "dob"').querySelectorAll('option')].map(
            (o) => o.value
        );
        expect(values).not.toContain('kyber-aes');
        expect(values).toContain('encrypt');
        expect(values).toContain('legacy-kyber-aes');
        expect(values).toEqual(
            POLICY_STRINGS.filter((p) => !(DEPRECATED_POLICY_STRINGS as readonly string[]).includes(p))
        );
    });
});

describe('PolicySelector — generalisation policies', () => {
    it('offers year, age-band and bucket in the standard group', () => {
        renderSelector();
        const select = screen.getByLabelText('Policy for "dob"');
        for (const [value, label] of [
            ['year', 'Year only'],
            ['age-band', 'Age band'],
            ['bucket', 'Number range'],
        ]) {
            const opt = [...select.querySelectorAll('option')].find((o) => o.value === value);
            expect(opt?.textContent, value).toBe(label);
            expect(opt?.parentElement?.getAttribute('label')).toBe('Policies');
        }
    });

    it('shows no parameter inputs for plain policies or year', () => {
        renderSelector();
        expect(screen.queryByLabelText(/Width for/)).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Policy for "dob"'), { target: { value: 'year' } });
        expect(screen.queryByLabelText(/Width for/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Reference date for/)).not.toBeInTheDocument();
    });

    it('age-band shows a width and a pre-filled, editable reference date', () => {
        renderSelector();
        fireEvent.change(screen.getByLabelText('Policy for "dob"'), {
            target: { value: 'age-band' },
        });

        const date = screen.getByLabelText('Reference date for "dob"') as HTMLInputElement;
        expect(date.value).toMatch(/^\d{4}-01-01$/);
        expect(screen.getByLabelText('Width for "dob"')).toHaveValue(null);

        fireEvent.change(date, { target: { value: '2020-06-30' } });
        fireEvent.change(screen.getByLabelText('Width for "dob"'), { target: { value: '5' } });
        expect(policy()).toEqual({ type: 'age-band', referenceDate: '2020-06-30', width: 5 });
    });

    it('bucket shows only a width; blank or invalid width falls back to the default', () => {
        renderSelector();
        fireEvent.change(screen.getByLabelText('Policy for "dob"'), { target: { value: 'bucket' } });
        expect(screen.queryByLabelText(/Reference date for/)).not.toBeInTheDocument();

        const width = screen.getByLabelText('Width for "dob"');
        fireEvent.change(width, { target: { value: '20' } });
        expect(policy().width).toBe(20);
        fireEvent.change(width, { target: { value: '' } });
        expect(policy().width).toBeUndefined();
        fireEvent.change(width, { target: { value: '-3' } });
        expect(policy().width).toBeUndefined();
    });

    it('marks a cleared reference date invalid instead of silently using today', () => {
        renderSelector();
        fireEvent.change(screen.getByLabelText('Policy for "dob"'), {
            target: { value: 'age-band' },
        });
        const date = screen.getByLabelText('Reference date for "dob"');
        fireEvent.change(date, { target: { value: '' } });
        expect(policy().referenceDate).toBeUndefined();
        expect(date).toHaveAttribute('aria-invalid', 'true');
    });
});
