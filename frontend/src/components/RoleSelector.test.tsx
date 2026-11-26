import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoleSelector from './RoleSelector';
import RoleSuggestBar from './dashboard/RoleSuggestBar';
import { useDatasetStore } from '../store/datasetStore';

beforeEach(() => {
    useDatasetStore.getState().clearData();
    useDatasetStore.getState().setFileData(['email', 'city'], [['a@x', 'Bristol']], []);
    useDatasetStore.getState().initializePolicies(2);
});

describe('RoleSelector', () => {
    it('shows the pre-selected role and lets the user change it', () => {
        render(<RoleSelector colIndex={0} header="email" />);
        const select = screen.getByLabelText('Role for "email"') as HTMLSelectElement;
        expect(select.value).toBe('identifier');
        fireEvent.change(select, { target: { value: 'other' } });
        expect(useDatasetStore.getState().roles[0]).toBe('other');
    });

    it('flags a quasi-identifier left on Keep', () => {
        render(<RoleSelector colIndex={1} header="city" />);
        expect(screen.getByText(/Quasi-identifier kept as-is/)).toBeInTheDocument();
        useDatasetStore.getState().setPolicy(1, 'mask');
    });

    it('reserves the same fixed-height slot with and without the warning', () => {
        const { unmount } = render(<RoleSelector colIndex={1} header="city" />);
        const warned = screen.getByTestId('role-warning-slot');
        expect(warned).toHaveTextContent(/Quasi-identifier/);
        const cls = warned.className;
        expect(cls).toContain('h-8');
        unmount();
        render(<RoleSelector colIndex={0} header="email" />);
        const clear = screen.getByTestId('role-warning-slot');
        expect(clear).toBeEmptyDOMElement();
        expect(clear.className).toBe(cls);
    });
});

describe('RoleSuggestBar', () => {
    it('changes nothing until the button is pressed, then reports the count', () => {
        render(<RoleSuggestBar />);
        expect(screen.getByText(/Would change 1 of 2 columns/)).toBeInTheDocument();
        expect(useDatasetStore.getState().policies[0].type).toBe('keep');
        fireEvent.click(screen.getByRole('button', { name: 'Suggest policies from roles' }));
        expect(useDatasetStore.getState().policies[0].type).toBe('redact');
        expect(screen.getByRole('status')).toHaveTextContent('Suggestions applied: 1 column changed.');
    });
});
