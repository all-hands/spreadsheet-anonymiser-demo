import { displayCell } from '../lib/cell-display';
import type { Cell } from '../types/data';

const CellText = ({ value }: { value: Cell | undefined }) => {
    const { text, full, truncated } = displayCell(value);
    return (
        <span className="relative block truncate" title={full || undefined}>
            {truncated ? (
                <>
                    <span aria-hidden="true">{text}</span>
                    <span className="sr-only">{full}</span>
                </>
            ) : (
                text
            )}
        </span>
    );
};

export default CellText;
