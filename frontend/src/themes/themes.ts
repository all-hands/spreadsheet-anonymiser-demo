export interface ThemeVars {
    '--background': string;
    '--surface': string;
    '--surface-2': string;
    '--surface-hover': string;
    '--foreground': string;
    '--muted': string;
    '--border': string;
    '--accent': string;
    '--accent-hover': string;
    '--accent-foreground': string;
}

export interface Theme {
    key: string;
    name: string;
    description: string;
    isDark: boolean;
    vars: ThemeVars;
}

const build = (
    key: string,
    name: string,
    description: string,
    isDark: boolean,
    p: { background: string; cardBg: string; tint: string; primary: string; primaryLight: string; textOnPrimary: string },
): Theme => ({
    key,
    name,
    description,
    isDark,
    vars: {
        '--background': p.background,
        '--surface': p.cardBg,
        '--surface-2': p.tint,
        '--surface-hover': p.tint,
        '--foreground': isDark ? '#F9FAFB' : '#111827',
        '--muted': isDark ? '#A9AFB9' : '#4B5563',
        '--border': isDark ? p.tint : '#E2E8F0',
        '--accent': p.primary,
        '--accent-hover': p.primaryLight,
        '--accent-foreground': p.textOnPrimary,
    },
});

export const themes: Theme[] = [
    {
        key: 'default-dark',
        name: 'Spreadsheet Anonymiser Dark',
        description: 'Original dark look',
        isDark: true,
        vars: {
            '--background': '#030712',
            '--surface': '#111827',
            '--surface-2': '#1F2937',
            '--surface-hover': '#374151',
            '--foreground': '#FFFFFF',
            '--muted': '#A9AFB9',
            '--border': '#1F2937',
            '--accent': '#2563EB',
            '--accent-hover': '#3B82F6',
            '--accent-foreground': '#FFFFFF',
        },
    },
    build('classic-navy', 'Classic Navy', 'Navy & light blue', false, {
        background: '#F5F5F5', cardBg: '#FFFFFF', tint: '#E8EDF5',
        primary: '#171C54', primaryLight: '#2871AD', textOnPrimary: '#FFFFFF',
    }),
    build('ocean', 'Ocean', 'Blue & petrol — cool professional', false, {
        background: '#F0F4F8', cardBg: '#FFFFFF', tint: '#DCE7F0',
        primary: '#2871AD', primaryLight: '#3771A4', textOnPrimary: '#FFFFFF',
    }),
    build('forest', 'Forest', 'Olive & petrol — natural tones', false, {
        background: '#F5F7F6', cardBg: '#FFFFFF', tint: '#E1EBE5',
        primary: '#557D68', primaryLight: '#4E7960', textOnPrimary: '#FFFFFF',
    }),
    build('sunset', 'Sunset', 'Orange & ocher — warm energy', false, {
        background: '#FFFAF5', cardBg: '#FFFFFF', tint: '#F7E9DD',
        primary: '#B75932', primaryLight: '#BA542A', textOnPrimary: '#FFFFFF',
    }),
    build('berry', 'Berry', 'Magenta & red — bold vibrant', false, {
        background: '#FDF5F8', cardBg: '#FFFFFF', tint: '#F5E0EA',
        primary: '#B62D7A', primaryLight: '#C63283', textOnPrimary: '#FFFFFF',
    }),
    build('midnight', 'Midnight', 'Dark navy — professional dark', true, {
        background: '#171C54', cardBg: '#1E2563', tint: '#2A3A5C',
        primary: '#2B7ABB', primaryLight: '#5A9BC7', textOnPrimary: '#FFFFFF',
    }),
    build('charcoal', 'Charcoal', 'Dark grey — sleek modern', true, {
        background: '#1A1A1A', cardBg: '#252525', tint: '#2D2D2D',
        primary: '#2974B1', primaryLight: '#67987F', textOnPrimary: '#FFFFFF',
    }),
    build('twilight', 'Twilight', 'Dark purple — creative mood', true, {
        background: '#1A1525', cardBg: '#252030', tint: '#2A2035',
        primary: '#C43184', primaryLight: '#D17B58', textOnPrimary: '#FFFFFF',
    }),
];

export const defaultTheme = themes.find((t) => t.key === 'default-dark') ?? themes[0];
