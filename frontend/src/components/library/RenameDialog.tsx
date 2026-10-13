import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ALL_DEPTH } from '@/library/catalog';
import { useModels } from '@/library/hooks';
import type { ModelSubtype } from '@/library/types';
import { useTranslation } from '@/i18n';

/** Splits a full name into its folder and its file name. */
function splitName(full: string): { folder: string; name: string } {
    const slash = full.lastIndexOf('/');
    return slash < 0 ? { folder: '', name: full } : { folder: full.slice(0, slash), name: full.slice(slash + 1) };
}

/** Renaming a model or wildcard: a folder picked from the ones this subtype already has, and a
 *  file name, as legacy's rename_model_modal. The listing behind the folder list is the same
 *  whole-library one the Generate pickers load, so it is usually already cached. */
export function RenameDialog(props: {
    /** Full name being renamed, or null while closed. */
    target: string | null;
    subtype: ModelSubtype;
    title: string;
    hint?: string;
    onConfirm: (newName: string) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const open = props.target !== null;
    const listing = useModels(props.subtype, '', 'Name', false, ALL_DEPTH, open);
    const [folder, setFolder] = useState('');
    const [name, setName] = useState('');

    useEffect(() => {
        if (props.target !== null) {
            const parts = splitName(props.target);
            setFolder(parts.folder);
            setName(parts.name);
        }
    }, [props.target]);

    const folders = useMemo(() => {
        const known = new Set(listing.data?.folders ?? []);
        // The entry's own folder is always a choice, even before the listing arrives.
        if (folder) {
            known.add(folder);
        }
        return [...known].sort((a, b) => a.localeCompare(b));
    }, [listing.data, folder]);

    // As legacy's modelRenameNameInput: the server turns spaces into underscores anyway, so they are
    // shown that way up front. Slashes in the name still work, and make new folders.
    const cleanName = name.trim();
    const newName = cleanName ? (folder ? `${folder}/${cleanName}` : cleanName) : '';
    const valid = newName !== '' && !cleanName.endsWith('/') && newName !== props.target;

    return (
        <Dialog.Root open={open} onOpenChange={next => !next && props.onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[min(32rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-1 text-base font-medium text-fg-strong">{props.title}</Dialog.Title>
                    <Dialog.Description className="mb-3 break-all font-mono text-xs text-fg-soft">
                        {props.target}
                    </Dialog.Description>
                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="rename-folder">
                        {t('rename.folder')}
                    </label>
                    <select
                        id="rename-folder"
                        value={folder}
                        onChange={e => setFolder(e.target.value)}
                        className="mb-3 w-full rounded border border-default bg-surface-sunken px-2 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    >
                        <option value="">{t('rename.rootFolder')}</option>
                        {folders.map(option => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="rename-name">
                        {t('rename.name')}
                    </label>
                    <input
                        id="rename-name"
                        type="text"
                        value={name}
                        autoFocus
                        onChange={e =>
                            setName(props.subtype === 'Wildcards' ? e.target.value : e.target.value.replaceAll(' ', '_'))
                        }
                        onKeyDown={e => {
                            if (e.key === 'Enter' && valid) {
                                props.onConfirm(newName);
                            }
                        }}
                        className="w-full rounded border border-default bg-surface-sunken px-2 py-1.5 font-mono text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                        style={cleanName ? undefined : { borderColor: 'var(--backend-errored)' }}
                    />
                    {props.hint && <p className="mt-1.5 text-xs text-fg-soft">{props.hint}</p>}
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
                            disabled={!valid}
                            onClick={() => props.onConfirm(newName)}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {t('modelBrowser.rename')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
