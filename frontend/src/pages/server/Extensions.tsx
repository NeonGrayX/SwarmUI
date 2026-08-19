import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { api } from '@/api/client';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface InstalledExtension {
    name: string;
    version: string;
    author: string;
    description: string;
    license: string;
    readme_url: string;
    tags: string[];
    is_core: boolean;
    can_update: boolean;
    is_old_repo: boolean;
}

interface AvailableExtension {
    name: string;
    author: string;
    description: string;
    license: string;
    url: string;
    tags: string[];
    folder_names: string[];
    is_installed: boolean;
    is_disabled: boolean;
}

/** Tags that warrant a visible warning before installing. Mirrors ExtensionInfo.IsDangerTags. */
const DANGER_TAGS = new Set(['lowquality', 'conflicts', 'beta']);

/** Extension manager.
 *
 * Data comes from the ListExtensions API added for this UI; the legacy page renders the same
 * information server-side into Razor markup (src/Pages/_Generate/ServerTab.cshtml), which an SPA
 * cannot consume. The legacy layout is two bare full-bleed <table>s with 30+ rows and no search. */
export function ExtensionsPage() {
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<'installed' | 'available'>('installed');
    const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);
    const [needsRestart, setNeedsRestart] = useState(false);

    const extensions = useQuery({
        queryKey: ['extensions'],
        queryFn: () => api.post<{ installed: InstalledExtension[]; available: AvailableExtension[] }>('ListExtensions')
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['extensions'] });
    const afterChange = () => {
        setNeedsRestart(true);
        refresh();
    };

    const install = useMutation({
        mutationFn: (name: string) => api.post('InstallExtension', { extensionName: name }),
        onSuccess: afterChange
    });
    const uninstall = useMutation({
        mutationFn: (name: string) => api.post('UninstallExtension', { extensionName: name }),
        onSuccess: afterChange
    });
    const update = useMutation({
        mutationFn: (name: string) => api.post('UpdateExtension', { extensionName: name }),
        onSuccess: afterChange
    });

    const query = search.trim().toLowerCase();
    const installed = useMemo(
        () =>
            (extensions.data?.installed ?? []).filter(e =>
                `${e.name} ${e.author} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(query)
            ),
        [extensions.data, query]
    );
    const available = useMemo(
        () =>
            (extensions.data?.available ?? []).filter(
                e =>
                    !e.is_installed &&
                    `${e.name} ${e.author} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(query)
            ),
        [extensions.data, query]
    );

    const rows = tab === 'installed' ? installed : available;

    return (
        <div className="flex h-full min-h-0 flex-col">
            {needsRestart && (
                <div
                    className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-sm"
                    style={{
                        background: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 18%, transparent)',
                        borderColor: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 40%, transparent)'
                    }}
                >
                    <span className="flex-1 text-fg">
                        Extension changes take effect after a server restart.
                    </span>
                    <button
                        type="button"
                        onClick={() => api.post('UpdateAndRestart', { updateExtensions: false }).catch(() => {})}
                        className="rounded border border-default px-2 py-1 text-xs text-fg hover:bg-[var(--sw-hover)]"
                    >
                        Restart server
                    </button>
                </div>
            )}

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2">
                <div className="flex rounded border border-default overflow-hidden">
                    {(['installed', 'available'] as const).map(id => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            aria-pressed={tab === id}
                            className="px-3 py-1 text-xs capitalize transition-colors"
                            style={
                                tab === id
                                    ? { background: 'var(--sw-active)', color: 'var(--text-strong)' }
                                    : { color: 'var(--sw-fg-soft)' }
                            }
                        >
                            {id} ({id === 'installed' ? installed.length : available.length})
                        </button>
                    ))}
                </div>
                <div className="relative min-w-48 max-w-sm flex-1">
                    <Search
                        size={14}
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search extensions…"
                        aria-label="Search extensions"
                        className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-2 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {extensions.isPending ? (
                    <p className="text-sm text-fg-soft">Loading extensions…</p>
                ) : extensions.isError ? (
                    <p className="text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {extensions.error instanceof Error ? extensions.error.message : 'Failed to load extensions.'}
                    </p>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-fg-soft">
                        {query ? `No extensions match "${search.trim()}".` : `No ${tab} extensions.`}
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {rows.map(row => {
                            const isInstalled = 'is_core' in row;
                            const ext = row as InstalledExtension & AvailableExtension;
                            const danger = ext.tags.some(t => DANGER_TAGS.has(t.toLowerCase()));
                            return (
                                <li
                                    key={ext.name}
                                    className="flex items-start gap-3 rounded-lg border border-default bg-surface p-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium text-fg-strong">{ext.name}</span>
                                            {isInstalled && ext.is_core && <Tag label="core" />}
                                            {isInstalled && ext.is_old_repo && <Tag label="old repo" danger />}
                                            {!isInstalled && ext.is_disabled && <Tag label="disabled" />}
                                            {ext.tags.map(tag => (
                                                <Tag key={tag} label={tag} danger={DANGER_TAGS.has(tag.toLowerCase())} />
                                            ))}
                                        </div>
                                        <p className="mt-0.5 text-sm text-fg-soft">{ext.description}</p>
                                        <p className="mt-1 text-xs text-fg-soft opacity-70">
                                            {ext.author}
                                            {ext.license && ` · ${ext.license}`}
                                            {isInstalled && ext.version && ` · ${ext.version}`}
                                        </p>
                                        {danger && !isInstalled && (
                                            <p className="mt-1 text-xs" style={{ color: 'var(--status-bar-warn-color-start-end)' }}>
                                                Flagged as low-quality, beta, or known to conflict with other extensions.
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        {(ext.readme_url || ext.url) && (
                                            <a
                                                href={ext.readme_url || ext.url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                                            >
                                                Readme
                                                <ExternalLink size={11} aria-hidden />
                                            </a>
                                        )}
                                        {isInstalled ? (
                                            <>
                                                {ext.can_update && (
                                                    <ActionButton
                                                        label="Update"
                                                        onClick={() => update.mutate(ext.name)}
                                                    />
                                                )}
                                                {!ext.is_core && (
                                                    <ActionButton
                                                        label="Uninstall"
                                                        destructive
                                                        onClick={() => setPendingUninstall(ext.name)}
                                                    />
                                                )}
                                            </>
                                        ) : (
                                            <ActionButton label="Install" primary onClick={() => install.mutate(ext.name)} />
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={pendingUninstall !== null}
                title="Uninstall extension?"
                body={
                    <>
                        <strong className="text-fg">{pendingUninstall}</strong> will be removed from disk.
                        A server restart is needed for this to take effect.
                    </>
                }
                confirmLabel="Uninstall"
                destructive
                onConfirm={() => {
                    if (pendingUninstall) {
                        uninstall.mutate(pendingUninstall);
                    }
                    setPendingUninstall(null);
                }}
                onCancel={() => setPendingUninstall(null)}
            />
        </div>
    );
}

function Tag(props: { label: string; danger?: boolean }) {
    return (
        <span
            className="rounded-full px-1.5 py-0.5 text-[10px] leading-none"
            style={
                props.danger
                    ? { background: 'var(--sw-danger-surface)', color: 'var(--text)' }
                    : { background: 'var(--background-soft)', color: 'var(--sw-fg-soft)' }
            }
        >
            {props.label}
        </span>
    );
}

function ActionButton(props: { label: string; onClick: () => void; primary?: boolean; destructive?: boolean }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="rounded border px-2.5 py-1 text-xs"
            style={
                props.primary
                    ? { background: 'var(--emphasis)', color: 'var(--sw-accent-fg)', borderColor: 'transparent' }
                    : props.destructive
                      ? { color: 'var(--backend-errored)', borderColor: 'var(--border-color)' }
                      : { color: 'var(--text)', borderColor: 'var(--border-color)' }
            }
        >
            {props.label}
        </button>
    );
}
