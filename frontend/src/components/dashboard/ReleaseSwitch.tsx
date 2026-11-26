import Explain from '../Explain';
import { releaseAllowedProse } from '../../lib/anonymity';

const ReleaseSwitch = ({
    anonymousRelease, problems, onChange,
}: {
    anonymousRelease: boolean;
    problems: string[];
    onChange: (on: boolean) => void;
}) => (
        <div className="border-t border-border pt-3 flex flex-col gap-2">
            <Explain k="release.switch">
            <label className="flex items-center gap-3 text-sm font-medium text-foreground cursor-pointer w-fit">
                <input
                    type="checkbox"
                    role="switch"
                    checked={anonymousRelease}
                    aria-checked={anonymousRelease}
                    onChange={(e) => onChange(e.target.checked)}
                    aria-label="Anonymous release"
                    className="peer sr-only"
                />
                <span
                    aria-hidden="true"
                    className="relative inline-block h-5 w-9 shrink-0 rounded-full border border-border bg-surface-2 transition-colors peer-checked:bg-accent peer-checked:border-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-foreground after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-accent-foreground"
                />
                <span>Anonymous release <span className="font-normal text-muted">{anonymousRelease ? 'On' : 'Off'}</span></span>
            </label>
            </Explain>
            <p className="text-xs text-muted">
                Applies the column policies, then suppresses groups smaller than k. Allows only {releaseAllowedProse()}; produces no salt file; exports only if the check passes. It is a
                statistical check on this file: it does not cover linkage with other datasets, free-text columns or
                small files.
            </p>
            {anonymousRelease && problems.length > 0 && (
                <ul role="alert" aria-label="Anonymous release blockers" className="list-disc pl-5 text-xs text-danger flex flex-col gap-1">
                    {problems.map((p) => (
                        <li key={p}>{p}</li>
                    ))}
                </ul>
            )}
            {anonymousRelease && problems.length === 0 && (
                <p className="text-xs text-success">
                    Ready: the check runs on the Process button, and the file downloads only if it passes.
                </p>
            )}
        </div>
);

export default ReleaseSwitch;
