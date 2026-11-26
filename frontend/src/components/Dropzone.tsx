import { useState, useRef } from 'react';
import { clsx } from 'clsx';
import { ACCEPT_ATTRIBUTE, SUPPORTED_FORMATS_LABEL } from '../lib/constants';
import { DemoFiles } from './DemoFiles';
import Explain from './Explain';

interface DropzoneProps {
    onFile: (file: File) => void;
}

export const Dropzone = ({ onFile }: DropzoneProps) => {
    const [isDragActive, setIsDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragActive(true);
    };

    const onDragLeave = () => {
        setIsDragActive(false);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragActive(false);
        const files = Array.from(e.dataTransfer.files);

        if (files.length > 0) {
            onFile(files[0]);
        }
    };

    const onClick = () => {
        fileInputRef.current?.click();
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
        }
    };

    const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;

        if (files && files.length > 0) {
            onFile(files[0]);
        }
        e.target.value = '';
    };

    return (
        <div className="w-full">
        <Explain k="dropzone">
        <div
            role="button"
            tabIndex={0}
            aria-label="Upload a CSV, TSV, JSONL, Excel or ODS file: press Enter or Space to browse, or drop a file here"
            onKeyDown={onKeyDown}
            onClick={onClick}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={clsx(
                "w-full h-64 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all duration-300 cursor-pointer overflow-hidden relative focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isDragActive
                    ? "border-success bg-success/10 scale-[1.02]"
                    : "border-muted hover:border-accent-hover hover:bg-surface-hover"
            )}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                onChange={onFileSelect}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
            />
            <div className="text-center z-10">
                <p className="text-lg font-medium text-foreground">
                    {isDragActive ? "Drop file here..." : "Drag & drop your data file"}
                </p>
                <p className="text-sm text-muted mt-2">
                    or click to browse ({SUPPORTED_FORMATS_LABEL})
                </p>
            </div>
        </div>
        </Explain>
        <div className="mt-4">
            <DemoFiles onFile={onFile} />
        </div>
        </div>
    );
};
