import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { comfyKeys, type ComfyBuildResult } from '@/comfy/actions';
import { graphToPrompt, type ComfyGraph } from '@/comfy/bridge';
import { ComfyWorkflowError } from '@/comfy/params';
import { useGenerateStore } from '@/generate/store';
import { useTranslation } from '@/i18n';

/** Saves the graph currently open in the editor into the workflow library.
 *
 * The stored entry is the graph plus the parameter set built from it, so reopening it in the
 * Generate tab needs no Comfy backend at all - which is what makes a saved workflow usable as an
 * ordinary Swarm parameter (`comfyuicustomworkflow`).
 */
export function ComfySaveDialog(props: {
    open: boolean;
    existingNames: string[];
    onClose: () => void;
    onNotice: (message: string, isError?: boolean) => void;
    build: (requireSave: boolean) => Promise<ComfyBuildResult>;
}) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [enableSimple, setEnableSimple] = useState(false);
    const [useThumbnail, setUseThumbnail] = useState(false);
    const [busy, setBusy] = useState(false);
    /** Whether the graph declares controls of its own. Assumed until the graph has been read, so
     *  the advice below only ever appears on a graph actually known to lack them. */
    const [declaresInputs, setDeclaresInputs] = useState(true);

    const currentImage = useGenerateStore(s => s.batch.find(item => item.id === s.selected));
    // Only a finished image is worth keeping; a live preview is half-rendered by definition.
    const thumbnailSrc = currentImage?.status === 'done' && !currentImage.isPreview ? currentImage.src : undefined;

    useEffect(() => {
        if (props.open) {
            setName('');
            setDescription('');
            setEnableSimple(false);
            setUseThumbnail(false);
        }
    }, [props.open]);

    // Read once as the dialog opens: the graph cannot change while it is up, and this is a plain
    // reach into the editor rather than the full parameter build the save itself does.
    useEffect(() => {
        if (!props.open) {
            return;
        }
        let cancelled = false;
        setDeclaresInputs(true);
        graphToPrompt().then(
            ({ workflow }) => !cancelled && setDeclaresInputs(declaresOwnInputs(workflow)),
            () => undefined
        );
        return () => {
            cancelled = true;
        };
    }, [props.open]);

    const trimmed = name.trim();
    const overwriting = props.existingNames.some(existing => existing.toLowerCase() === trimmed.toLowerCase());

    async function save(): Promise<void> {
        setBusy(true);
        try {
            props.onNotice(t('comfy.notice.saving'));
            const { input, workflow, prompt } = await props.build(false);
            // The two carriers describe the graph, which is stored beside them - keeping them here
            // as well would nest a copy of the workflow inside its own parameter list.
            const customParams = { ...input.params };
            delete customParams.comfyworkflowraw;
            delete customParams.comfyworkflowparammetadata;
            // A SwarmWorkflowDescription node in the graph is the author's own wording, and wins
            // over whatever is typed here.
            let finalDescription = description;
            let finalSimple = enableSimple;
            for (const node of workflow.nodes ?? []) {
                if (node.type === 'SwarmWorkflowDescription' && Array.isArray(node.widgets_values)) {
                    finalDescription = `${node.widgets_values[0] ?? ''}`;
                    finalSimple = node.widgets_values[1] === true;
                    break;
                }
            }
            await api.post('ComfySaveWorkflow', {
                name: trimmed,
                description: finalDescription,
                enable_in_simple: finalSimple,
                workflow: JSON.stringify(workflow),
                prompt,
                custom_params: customParams,
                param_values: input.paramVal,
                image: useThumbnail && thumbnailSrc ? await toDataUrl(thumbnailSrc) : null
            });
            await queryClient.invalidateQueries({ queryKey: comfyKeys.workflows });
            props.onNotice(t('comfy.notice.saved'));
            props.onClose();
        }
        catch (e) {
            if (e instanceof ComfyWorkflowError) {
                props.onNotice(t('comfy.error.noSaveNode'), true);
            }
            else {
                props.onNotice(e instanceof Error ? e.message : String(e), true);
            }
        }
        finally {
            setBusy(false);
        }
    }

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/4 z-50 w-[min(30rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-3 text-base font-medium text-fg-strong">
                        {t('comfy.save.title')}
                    </Dialog.Title>

                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="comfy-save-name">
                        {t('comfy.save.name')}
                    </label>
                    <input
                        id="comfy-save-name"
                        type="text"
                        value={name}
                        autoFocus
                        list="comfy-save-name-options"
                        placeholder={t('comfy.save.namePlaceholder')}
                        onChange={e => setName(e.target.value)}
                        className="w-full rounded border border-default bg-surface-sunken px-2 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    <datalist id="comfy-save-name-options">
                        {props.existingNames.map(existing => (
                            <option key={existing} value={existing} />
                        ))}
                    </datalist>
                    {overwriting && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {t('comfy.save.overwriteBody', { name: trimmed })}
                        </p>
                    )}

                    <label className="mb-1 mt-3 block text-xs text-fg-soft" htmlFor="comfy-save-description">
                        {t('comfy.save.description')}
                    </label>
                    <textarea
                        id="comfy-save-description"
                        value={description}
                        rows={3}
                        placeholder={t('comfy.save.descriptionPlaceholder')}
                        onChange={e => setDescription(e.target.value)}
                        className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />

                    <div className="mt-3 space-y-1.5">
                        <Checkbox id="comfy-save-simple" checked={enableSimple} onChange={setEnableSimple}>
                            {t('comfy.save.enableSimple')}
                        </Checkbox>
                        {enableSimple && !declaresInputs && (
                            <p className="pl-6 text-xs text-fg-soft">{t('comfy.save.simpleNoInputs')}</p>
                        )}
                        <Checkbox
                            id="comfy-save-thumb"
                            checked={useThumbnail}
                            disabled={!thumbnailSrc}
                            onChange={setUseThumbnail}
                        >
                            {t('comfy.save.useImage')}
                        </Checkbox>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('common.cancel')}
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            onClick={save}
                            disabled={!trimmed || busy}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {busy ? t('common.saving') : t('comfy.bar.save')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Checkbox(props: {
    id: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (on: boolean) => void;
    children: React.ReactNode;
}) {
    return (
        <label
            htmlFor={props.id}
            className={`flex items-center gap-2 text-sm ${props.disabled ? 'text-fg-soft opacity-60' : 'text-fg'}`}
        >
            <input
                id={props.id}
                type="checkbox"
                checked={props.checked}
                disabled={props.disabled}
                onChange={e => props.onChange(e.target.checked)}
            />
            {props.children}
        </label>
    );
}

/** Whether the graph declares its own controls, ie carries SwarmInput nodes.
 *
 * That is what the Simple workspace is for: a panel the workflow's author designed. Without them
 * Swarm falls back to auto-claiming raw node inputs (buildComfyParams, `doAutoClaim`), which still
 * runs, but presents the graph's internals rather than a set of controls. Group nodes only arrange
 * the others, so one on its own declares nothing. */
function declaresOwnInputs(workflow: ComfyGraph): boolean {
    return (workflow.nodes ?? []).some(
        node => node.type?.startsWith('SwarmInput') && node.type !== 'SwarmInputGroup'
    );
}

/** The saved thumbnail travels inline, so the image has to come back as data rather than a path. */
async function toDataUrl(src: string): Promise<string> {
    if (src.startsWith('data:')) {
        return src;
    }
    const blob = await (await fetch(src)).blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('read-failed'));
        reader.readAsDataURL(blob);
    });
}
