import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { PseudonymisationNotice } from './PseudonymisationNotice';
import { PSEUDONYMISED_LINE } from '../lib/notices';

describe('PseudonymisationNotice', () => {
    it('states the output is pseudonymised and personal data under GDPR', () => {
        render(<PseudonymisationNotice />);
        const note = screen.getByRole('note', { name: 'Pseudonymisation notice' });
        expect(note).toHaveTextContent(PSEUDONYMISED_LINE);
        expect(note).toHaveTextContent(/GDPR/);
        expect(note).toHaveTextContent(/kept columns/);
    });

    it('offers no way to dismiss it', () => {
        render(<PseudonymisationNotice />);
        expect(screen.queryByRole('button', { name: /dismiss|close|hide/i })).not.toBeInTheDocument();
    });

    it('keeps the pseudonymised wording by default', () => {
        render(<PseudonymisationNotice />);
        expect(screen.getByRole('note')).toHaveAttribute('data-variant', 'pseudonymised');
    });

    it('switches to the measured wording only when a passed check is supplied', () => {
        render(<PseudonymisationNotice anonymity={{ k: 5, mode: 'cells', quasiIdentifiers: ['dob'] }} />);
        const note = screen.getByRole('note');
        expect(note).toHaveAttribute('data-variant', 'k-anonymity');
        expect(note).toHaveTextContent('k-anonymity k=5 measured, local suppression applied');
        expect(note).toHaveTextContent(/linkage with other datasets/);
        expect(note).not.toHaveTextContent(PSEUDONYMISED_LINE);
        expect(screen.queryByRole('button', { name: /dismiss|close/i })).not.toBeInTheDocument();
    });

    it('toggles the pseudonymised explainer from the (why?) button', () => {
        render(<PseudonymisationNotice />);
        const btn = screen.getByRole('button', { name: '(why?)' });
        expect(btn).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'true');
        const panel = screen.getByRole('region');
        expect(btn.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel).toHaveTextContent(/No tool can certify/);
        expect(within(panel).getByRole('table', { name: /same token/i })).toBeInTheDocument();
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('is a native button, so it works from the keyboard', () => {
        render(<PseudonymisationNotice />);
        const btn = screen.getByRole('button', { name: '(why?)' });
        btn.focus();
        expect(btn.tagName).toBe('BUTTON');
        expect(btn).toHaveAttribute('type', 'button');
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'true');
    });

    it('gives the k-anonymity notice its own explainer', () => {
        render(<PseudonymisationNotice anonymity={{ k: 5, mode: 'cells', quasiIdentifiers: ['dob'] }} />);
        fireEvent.click(screen.getByRole('button', { name: '(why?)' }));
        expect(screen.getByRole('region')).toHaveTextContent(/diabetes/);
    });
});
