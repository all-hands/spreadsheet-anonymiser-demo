import { Download } from 'lucide-react';
import type { Artifact } from '../lib/download';
import Explain from './Explain';

interface DownloadLinksProps {
    artifacts: Artifact[];
}

const DownloadLinks = ({ artifacts }: DownloadLinksProps) => {
    if (artifacts.length === 0) return null;
    return (
        <div className="mt-3 flex flex-col gap-1.5 items-center z-10">
            {artifacts.map((a) => (
                <Explain key={a.url} k="download.link">
                <a
                    href={a.url}
                    download={a.name}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-hover border border-border text-foreground text-sm font-mono transition-colors"
                >
                    <Download size={14} />
                    {a.name}
                </a>
                </Explain>
            ))}
        </div>
    );
};

export default DownloadLinks;
