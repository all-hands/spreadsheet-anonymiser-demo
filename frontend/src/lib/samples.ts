export interface Sample {
    id: string;
    label: string;
    description: string;
    path: string;
    format: 'csv' | 'tsv' | 'jsonl' | 'xlsx' | 'ods';
}

export const SAMPLE_MIME: Record<Sample['format'], string> = {
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    jsonl: 'application/x-ndjson',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

export const SAMPLES: readonly Sample[] = [
    { id: 'customers', label: 'Customers (CSV)', description: '60 customers: names, emails, phones, dates of birth, postcodes, salary.', path: '/samples/customers.csv', format: 'csv' },
    { id: 'patients', label: 'Patients (TSV)', description: '40 patient visits with a sensitive diagnosis column.', path: '/samples/patients.tsv', format: 'tsv' },
    { id: 'orders', label: 'Orders (JSONL)', description: '40 shop orders with customer and delivery details.', path: '/samples/orders.jsonl', format: 'jsonl' },
    { id: 'employees', label: 'Employees (Excel)', description: '30 staff records with salary and bank sort codes.', path: '/samples/employees.xlsx', format: 'xlsx' },
    { id: 'volunteers', label: 'Volunteers (ODS)', description: '30 volunteers with contact details, shift times and an allergy column.', path: '/samples/volunteers.ods', format: 'ods' },
];

export const loadSample = async (sample: Sample): Promise<File> => {
    const res = await fetch(sample.path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name = sample.path.slice(sample.path.lastIndexOf('/') + 1);
    return new File([blob], name, { type: SAMPLE_MIME[sample.format] });
};
