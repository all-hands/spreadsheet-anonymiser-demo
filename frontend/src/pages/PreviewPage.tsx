import { SideBySidePreview } from '../components/SideBySidePreview';
import { useDatasetStore } from '../store/datasetStore';

const PreviewPage = () => {
    const { headers, data, metadata } = useDatasetStore();

    if (!data || data.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted">
                <div className="text-center">
                    <p className="text-lg">No data loaded</p>
                    <p className="text-sm mt-2">
                        Upload a file in the Dashboard first to see the preview
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 p-6 overflow-hidden">
            <SideBySidePreview
                headers={headers}
                originalData={data}
                metadata={metadata}
            />
        </div>
    );
};

export default PreviewPage;
