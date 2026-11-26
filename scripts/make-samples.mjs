import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'frontend', 'public', 'samples');
const hucre = (part) => import(pathToFileURL(join(root, 'frontend', 'node_modules', 'hucre', 'dist', part)).href);
const { writeXlsx } = await hucre('xlsx.mjs');
const { writeOds } = await hucre('ods.mjs');

let s = 20261113;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[int(0, a.length - 1)];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const date = (y0, y1) => `${int(y0, y1)}-${pad(int(1, 12))}-${pad(int(1, 28))}`;

const first = ['Alder', 'Bramble', 'Cedar', 'Dahlia', 'Elder', 'Fern', 'Gorse', 'Hazel', 'Iris', 'Juniper', 'Kestrel', 'Laurel', 'Maple', 'Nettle', 'Olive', 'Poppy'];
const last = ['Testwell', 'Sampleton', 'Fakeman', 'Mockley', 'Demoson', 'Dummer', 'Placeholder', 'Notreal', 'Exemplar', 'Specimen'];
const cities = [['London', 'SW1A'], ['Leeds', 'LS1'], ['Bristol', 'BS1'], ['Glasgow', 'G1'], ['Cardiff', 'CF10'], ['York', 'YO1']];
const name = () => `${pick(first)} ${pick(last)}`;
const email = (n, i) => `${n.toLowerCase().replace(' ', '.')}.${i}@example.org`;
const phone = () => `+44 7700 900${pad(int(0, 999), 3)}`;
const postcode = (p) => `${p} ${int(1, 9)}${pick('ABDEFGHJLNPQRSTUWXYZ')}${pick('ABDEFGHJLNPQRSTUWXYZ')}`;
const csvCell = (v, d) => (/[",\n\t]/.test(String(v)) || String(v).includes(d) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
const table = (head, rows, d) => [head, ...rows].map((r) => r.map((v) => csvCell(v, d)).join(d)).join('\n') + '\n';

mkdirSync(out, { recursive: true });

const customers = Array.from({ length: 60 }, (_, i) => {
    const n = name();
    const [city, pc] = pick(cities);
    return [1001 + i, n, email(n, i + 1), phone(), date(1950, 2005), postcode(pc), city, int(21, 95) * 1000, pick(['free', 'standard', 'premium']), date(2021, 2026)];
});
writeFileSync(join(out, 'customers.csv'), table(['id', 'name', 'email', 'phone', 'dob', 'postcode', 'city', 'salary', 'plan', 'signup_date'], customers, ','));

const conditions = ['Asthma', 'Type 2 diabetes', 'Hypertension', 'Migraine', 'Anxiety disorder', 'Fractured wrist', 'None recorded'];
const patients = Array.from({ length: 40 }, (_, i) => {
    const n = name();
    return [`P-${pad(i + 1, 4)}`, n, date(1940, 2015), postcode(pick(cities)[1]), pick(conditions), int(150, 195), int(50, 110), date(2025, 2026), `Dr ${pick(last)}`];
});
writeFileSync(join(out, 'patients.tsv'), table(['patient_id', 'name', 'dob', 'postcode', 'diagnosis', 'height_cm', 'weight_kg', 'visit_date', 'clinician'], patients, '\t'));

const items = ['notebook', 'desk lamp', 'headphones', 'water bottle', 'keyboard', 'backpack'];
const orders = Array.from({ length: 40 }, (_, i) => {
    const n = name();
    const [city, pc] = pick(cities);
    return JSON.stringify({
        order_id: `ORD-${2000 + i}`,
        customer_name: n,
        customer_email: email(n, 100 + i),
        ship_city: city,
        ship_postcode: postcode(pc),
        item: pick(items),
        quantity: int(1, 5),
        total: Number((int(500, 20000) / 100).toFixed(2)),
        ordered_at: date(2025, 2026),
    });
});
writeFileSync(join(out, 'orders.jsonl'), orders.join('\n') + '\n');

const depts = ['Engineering', 'Finance', 'Operations', 'People', 'Sales'];
const employees = Array.from({ length: 30 }, (_, i) => {
    const n = name();
    return [`E${pad(i + 1, 3)}`, n, `${n.toLowerCase().replace(' ', '.')}@example.org`, pick(depts), int(28, 120) * 1000, date(2010, 2026), `${pad(int(10, 99))}-${pad(int(10, 99))}-${pad(int(10, 99))}`];
});
const bytes = await writeXlsx({
    sheets: [{ name: 'Employees', rows: [['employee_id', 'name', 'email', 'department', 'salary', 'start_date', 'bank_sort_code'], ...employees] }],
});
writeFileSync(join(out, 'employees.xlsx'), bytes);

const allergies = ['None', 'Peanuts', 'Gluten', 'Lactose', 'Penicillin'];
const volunteers = Array.from({ length: 30 }, (_, i) => {
    const n = name();
    const [city, pc] = pick(cities);
    return [`V${pad(i + 1, 3)}`, n, email(n, 300 + i), phone(), date(1950, 2006), postcode(pc), city, pick(allergies), `${pad(int(8, 17))}:${pick(['00', '15', '30', '45'])}`, int(2, 40)];
});
writeFileSync(
    join(out, 'volunteers.ods'),
    await writeOds({
        sheets: [{ name: 'Volunteers', rows: [['volunteer_id', 'name', 'email', 'phone', 'dob', 'postcode', 'city', 'allergy', 'shift_start', 'hours'], ...volunteers] }],
    }),
);
console.log('wrote samples to', out);
