export interface Artifact {
    url: string;
    name: string;
}

export const downloadBlob = (blob: Blob, name: string): Artifact => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { url, name };
};

export const toArtifact = (blob: Blob, name: string): Artifact => ({
    url: URL.createObjectURL(blob),
    name,
});

export const revokeArtifacts = (artifacts: Artifact[]) => {
    artifacts.forEach((a) => URL.revokeObjectURL(a.url));
};
