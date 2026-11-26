import Explain from './Explain';

export const SOURCE_URL = 'https://github.com/all-hands/spreadsheet-anonymiser-demo';

const SourceLink = ({ className = '' }: { className?: string }) => (
    <Explain k="source">
        <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs text-muted hover:text-foreground transition-colors ${className}`}
        >
            Source code (AGPL-3.0)
        </a>
    </Explain>
);

export default SourceLink;
