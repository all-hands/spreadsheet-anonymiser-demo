import { describe, expect, it } from 'vitest';
import {
    columnType, headerNamesDirectIdentifier, isDateColumn, isNumericColumn, isUngeneralisedQuasi, suggestRole,
    suggestRoles, suggestedPolicyForRole,
} from './roles';

describe('suggestRole', () => {
    it.each([
        ['email', 'text', 'identifier'],
        ['full_name', 'text', 'identifier'],
        ['firstName', 'text', 'identifier'],
        ['phone', 'text', 'identifier'],
        ['customer_id', 'text', 'identifier'],
        ['contact', 'phone', 'identifier'],
        ['dob', 'date', 'quasi-identifier'],
        ['Age', 'text', 'quasi-identifier'],
        ['postcode', 'text', 'quasi-identifier'],
        ['ZIP', 'text', 'quasi-identifier'],
        ['city', 'text', 'quasi-identifier'],
        ['gender', 'text', 'quasi-identifier'],
        ['diagnosis', 'text', 'sensitive'],
        ['salary', 'text', 'sensitive'],
        ['health_status', 'text', 'sensitive'],
        ['plan', 'text', 'other'],
        ['manager', 'text', 'other'],
        ['first_name', 'text', 'identifier'],
        ['surname', 'text', 'identifier'],
        ['fullname', 'text', 'identifier'],
        ['FullName', 'text', 'identifier'],
        ['ssn', 'text', 'identifier'],
        ['nino', 'text', 'identifier'],
        ['IBAN', 'text', 'identifier'],
        ['sort_code', 'text', 'identifier'],
        ['bank_sort_code', 'text', 'identifier'],
        ['account', 'text', 'identifier'],
        ['patient_id', 'text', 'identifier'],
        ['date_of_birth', 'text', 'quasi-identifier'],
        ['birth_year', 'text', 'quasi-identifier'],
        ['postal_code', 'text', 'quasi-identifier'],
        ['zip', 'text', 'quasi-identifier'],
        ['lat', 'text', 'quasi-identifier'],
        ['longitude', 'text', 'quasi-identifier'],
        ['annual_income', 'text', 'sensitive'],
        ['medical_condition', 'text', 'sensitive'],
    ] as const)('%s (%s) -> %s', (header, type, role) => {
        expect(suggestRole(header, type)).toBe(role);
    });

    it('a quasi-identifier word beats the identifier word "name" (city_name)', () => {
        expect(suggestRole('city_name', 'text')).toBe('quasi-identifier');
    });

    it('suggestRoles covers every header', () => {
        expect(suggestRoles(['id', 'dob'], [{ index: 1, header: 'dob', type: 'date', confidence: 1 }])).toEqual({
            0: 'identifier',
            1: 'quasi-identifier',
        });
    });
});

describe('suggestedPolicyForRole', () => {
    it('identifier -> redact', () => expect(suggestedPolicyForRole('identifier', 'email', false).type).toBe('redact'));
    it('quasi-identifier date -> year', () =>
        expect(suggestedPolicyForRole('quasi-identifier', 'date', false).type).toBe('year'));
    it('quasi-identifier numeric -> bucket', () =>
        expect(suggestedPolicyForRole('quasi-identifier', 'text', true).type).toBe('bucket'));
    it('other quasi-identifier stays keep (and is flagged)', () => {
        const p = suggestedPolicyForRole('quasi-identifier', 'text', false);
        expect(p.type).toBe('keep');
        expect(isUngeneralisedQuasi('quasi-identifier', p)).toBe(true);
        expect(isUngeneralisedQuasi('quasi-identifier', { type: 'year' })).toBe(false);
        expect(isUngeneralisedQuasi('sensitive', p)).toBe(false);
    });
    it('sensitive and other -> keep', () => {
        expect(suggestedPolicyForRole('sensitive', 'text', true).type).toBe('keep');
        expect(suggestedPolicyForRole('other', 'text', false).type).toBe('keep');
    });
});

describe('isNumericColumn', () => {
    it('is true when every non-empty cell is a number', () => {
        expect(isNumericColumn([['1'], [' 2.5 '], [''], [3]], 0)).toBe(true);
    });
    it('is false for text, and for an all-empty column', () => {
        expect(isNumericColumn([['1'], ['x']], 0)).toBe(false);
        expect(isNumericColumn([[''], [null]], 0)).toBe(false);
    });
});

describe('date columns the detector typed phone', () => {
    const rows = [['1980-12-11'], ['1990-01-02']];
    it('isDateColumn reads the cells', () => {
        expect(isDateColumn(rows, 0)).toBe(true);
        expect(isDateColumn([['1980-12-11'], ['x']], 0)).toBe(false);
    });
    it('columnType corrects phone to date, and leaves real phones alone', () => {
        const meta = [{ index: 0, header: 'dob', type: 'phone' as const, confidence: 1 }];
        expect(columnType(meta, rows, 0)).toBe('date');
        expect(columnType(meta, [['+44 7700 900440']], 0)).toBe('phone');
    });
    it('a dob header stays a quasi-identifier even when typed phone', () => {
        expect(suggestRole('dob', 'phone')).toBe('quasi-identifier');
        expect(suggestRole('signup_date', 'date')).toBe('other');
    });
    it('suggestRoles uses the cells: signup date is not an identifier', () => {
        const meta = [{ index: 0, header: 'signup_date', type: 'phone' as const, confidence: 1 }];
        expect(suggestRoles(['signup_date'], meta, rows)).toEqual({ 0: 'other' });
    });
});

describe('employee-style headers', () => {
    it('suggests department and start date as quasi-identifiers, the rest as before', () => {
        const headers = ['employee_id', 'name', 'email', 'department', 'salary', 'start_date', 'bank_sort_code'];
        const meta = [
            { index: 2, header: 'email', type: 'email', confidence: 1 },
            { index: 5, header: 'start_date', type: 'date', confidence: 1 },
        ] as const;
        expect(suggestRoles(headers, [...meta])).toEqual({
            0: 'identifier', 1: 'identifier', 2: 'identifier', 3: 'quasi-identifier',
            4: 'sensitive', 5: 'quasi-identifier', 6: 'identifier',
        });
    });
});

describe('headerNamesDirectIdentifier', () => {
    it.each([
        'email', 'E-mail', 'e_mail', 'Email Address', 'phone', 'Mobile', 'tel', 'telephone', 'name', 'Full Name',
        'first_name', 'lastName', 'surname', 'username', 'customer_name', 'address', 'home address', 'ssn',
        'National Insurance', 'NI number', 'passport', 'passport_no', 'IBAN', 'account number', 'account_no',
    ])('counts %s', (h) => expect(headerNamesDirectIdentifier(h)).toBe(true));
    it.each([
        'company_name', 'product_name', 'department name', 'file_name', 'account_type', 'order_id', 'city',
        'salary', 'mail_sent', 'nickname_count', 'signup_date', 'ni', '',
    ])('does not count %s', (h) => expect(headerNamesDirectIdentifier(h)).toBe(false));
});
