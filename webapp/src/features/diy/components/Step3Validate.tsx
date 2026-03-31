import type { ValidationResult, PinMapping } from "../types";

export interface Step3ValidateProps {
    validation: ValidationResult;
    pins: PinMapping[];
    onNext: () => void;
    onBack: () => void;
    isReady: boolean;
}

export function Step3Validate({ validation, pins, onNext, onBack, isReady }: Step3ValidateProps) {
    const isSetupValid = validation.errors.length === 0;

    return (
        <div className="flex flex-col max-w-[960px] mx-auto w-full gap-8">
            <div className="flex flex-col gap-3">
                <h1 className="text-slate-900 dark:text-white dark:text-white text-3xl font-bold">Validate Configuration</h1>
                <p className="text-slate-500 dark:text-slate-400 dark:text-slate-400 text-sm">Scanning pin configurations for conflicts</p>
            </div>

            {isSetupValid ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-primary/5 dark:bg-primary/10 rounded-xl border border-primary/20 mb-2">
                    <div className="size-20 bg-green-500 text-white rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/20">
                        <span className="material-symbols-outlined text-4xl">check_circle</span>
                    </div>
                    <h2 className="text-slate-900 dark:text-white dark:text-white text-3xl font-bold leading-tight mb-2">Validation Successful</h2>
                    <p className="text-slate-600 dark:text-slate-400 dark:text-slate-400 text-lg max-w-lg">
                        No electrical or logical conflicts were detected in your configuration. The hardware mapping is safe for deployment.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-rose-50 dark:bg-rose-500/10 rounded-xl border border-rose-200 dark:border-rose-500/20 mb-2">
                    <div className="size-20 bg-rose-500 text-white rounded-full flex items-center justify-center mb-6 shadow-lg shadow-rose-500/20">
                        <span className="material-symbols-outlined text-4xl">error</span>
                    </div>
                    <h2 className="text-slate-900 dark:text-white dark:text-white text-3xl font-bold leading-tight mb-2">Validation Failed</h2>
                    <p className="text-slate-600 dark:text-slate-400 dark:text-slate-400 text-lg max-w-lg">
                        There are {validation.errors.length} errors that must be resolved before you can proceed to flashing.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex flex-col gap-2 rounded-xl p-6 border border-border-light dark:border-border-dark dark:border-slate-800 bg-surface-light dark:bg-surface-dark dark:bg-slate-900/50">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 dark:text-slate-400 mb-1">
                        <span className="material-symbols-outlined text-sm">settings_input_component</span>
                        <p className="text-sm font-medium leading-normal">Mapped Pins</p>
                    </div>
                    <p className="text-slate-900 dark:text-white dark:text-white tracking-tight text-3xl font-bold leading-tight">
                        {pins.length}
                    </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl p-6 border border-border-light dark:border-border-dark dark:border-slate-800 bg-surface-light dark:bg-surface-dark dark:bg-slate-900/50">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 dark:text-slate-400 mb-1">
                        <span className="material-symbols-outlined text-sm">bolt</span>
                        <p className="text-sm font-medium leading-normal">Operating Voltage</p>
                    </div>
                    <p className="text-slate-900 dark:text-white dark:text-white tracking-tight text-3xl font-bold leading-tight">
                        3.3V <span className="text-sm font-normal text-slate-500 dark:text-slate-400">DC</span>
                    </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl p-6 border border-border-light dark:border-border-dark dark:border-slate-800 bg-surface-light dark:bg-surface-dark dark:bg-slate-900/50">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 dark:text-slate-400 mb-1">
                        <span className="material-symbols-outlined text-sm">cable</span>
                        <p className="text-sm font-medium leading-normal">Hardware Status</p>
                    </div>
                    {isSetupValid ? (
                        <p className="text-green-500 tracking-tight text-3xl font-bold leading-tight">Ready</p>
                    ) : (
                        <p className="text-rose-500 tracking-tight text-3xl font-bold leading-tight">Conflicts</p>
                    )}
                </div>
            </div>

            <div className="bg-surface-light dark:bg-surface-dark dark:bg-slate-900 border border-border-light dark:border-border-dark dark:border-slate-800 rounded-xl overflow-hidden mb-4">
                <div className="px-6 py-4 border-b border-border-light dark:border-border-dark dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-800/50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-900 dark:text-white dark:text-white">Validation Log</h3>
                    {isSetupValid ? (
                        <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold uppercase tracking-wider">Passed</span>
                    ) : (
                        <span className="px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-xs font-bold uppercase tracking-wider">Failed</span>
                    )}
                </div>
                <div className="p-6 space-y-4 font-mono text-sm max-h-[400px] overflow-y-auto custom-scrollbar">
                    {validation.errors.map((error, idx) => (
                        <div key={`err-${idx}`} className="flex gap-4">
                            <span className="text-slate-400">[*]</span>
                            <span className="text-rose-500 font-bold">ERROR:</span>
                            <span className="text-slate-600 dark:text-slate-400 dark:text-slate-300">{error}</span>
                        </div>
                    ))}
                    {validation.warnings.map((warning, idx) => (
                        <div key={`warn-${idx}`} className="flex gap-4">
                            <span className="text-slate-400">[*]</span>
                            <span className="text-amber-500 font-bold">WARN:</span>
                            <span className="text-slate-600 dark:text-slate-400 dark:text-slate-300 italic">{warning}</span>
                        </div>
                    ))}
                    {isSetupValid && (
                        <div className="flex gap-4">
                            <span className="text-slate-400">[*]</span>
                            <span className="text-green-500 font-bold">SUCCESS:</span>
                            <span className="text-slate-600 dark:text-slate-400 dark:text-slate-300 font-bold">Validation complete. 0 errors.</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-between items-center border-t border-border-light dark:border-border-dark dark:border-slate-800 pt-8">
                <button onClick={onBack} className="w-full sm:w-auto px-8 py-3 rounded-lg border border-border-light dark:border-border-dark dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:text-slate-300 font-bold hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-2">
                    Back to Pins
                </button>
                <button onClick={onNext} disabled={!isReady} className="w-full sm:w-auto px-10 py-3 rounded-lg bg-primary text-white font-bold shadow-lg shadow-primary/30 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    Next: Flash Device
                    <span className="material-symbols-outlined">bolt</span>
                </button>
            </div>
        </div>
    );
}
