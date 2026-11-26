import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RoleSuggestBar from './RoleSuggestBar';
import { useDatasetStore } from '../../store/datasetStore';

beforeEach(() => {
    useDatasetStore.getState().clearData();
    useDatasetStore.getState().setFileData(['name', 'note'], [['Ann', 'x']], []);
    useDatasetStore.getState().initializePolicies(2);
});

describe('RoleSuggestBar', () => {
    it('confirms in a live region after a run that changes columns, then after one that changes none', () => {
        render(<RoleSuggestBar />);
        const button = screen.getByRole('button', { name: /Suggest policies/ });
        fireEvent.click(button);
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('Suggestions applied: 1 column changed.');
        fireEvent.click(button);
        expect(status).toHaveTextContent('Suggestions applied: no column needed changing.');
    });
});
