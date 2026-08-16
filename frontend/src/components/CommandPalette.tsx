import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { usePermitted } from '@/api/permissions';
import { useSession, useT2IParams } from '@/api/hooks';
import { DESTINATIONS, findSection } from '@/nav/destinations';

/** Item values are "<label><TAB><extra search terms>". Splitting on tab rather than a space keeps
 *  multi-word labels intact for scoring. */
const VALUE_SEP = '\t';

function itemValue(label: string, ...extras: (string | null | undefined)[]): string {
    return `${label}${VALUE_SEP}${extras.filter(Boolean).join(' ')}`;
}

/** Substring-based ranking, replacing cmdk's default subsequence scoring.
 *
 * The default scorer matches any character subsequence, so searching "seed" scored a hit on
 * "Settings Appearance theme layout density dark light" and buried the 12 real Seed parameters
 * below eleven irrelevant screens. Requiring a contiguous substring makes results predictable,
 * and the tiers float the most specific match to the top. */
function scoreItem(value: string, search: string): number {
    const query = search.trim().toLowerCase();
    if (!query) {
        return 1;
    }
    const [label = '', extras = ''] = value.toLowerCase().split(VALUE_SEP);
    if (label === query) {
        return 1;
    }
    if (label.startsWith(query)) {
        return 0.9;
    }
    // Word-boundary hit inside the label, eg "seed" in "Variation Seed".
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}`).test(label)) {
        return 0.8;
    }
    if (label.includes(query)) {
        return 0.6;
    }
    if (extras.includes(query)) {
        return 0.3;
    }
    return 0;
}

/** Ctrl-K / Cmd-K palette.
 *
 * This is what actually solves navigation depth: with every destination and every generation
 * parameter reachable by name, nobody needs to remember that (for example) "Pickle To Safetensors"
 * lives under Utilities. The legacy UI offered no search of any kind across its ~25 screens. */
export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const navigate = useNavigate();
    const destinations = usePermitted(DESTINATIONS);
    const session = useSession();
    const params = useT2IParams(session.isSuccess);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen(o => !o);
            }
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    // Only surface parameters once the user has typed, otherwise 253 entries drown the destinations.
    const paramMatches = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (query.length < 2 || !params.data) {
            return [];
        }
        return params.data.list
            .filter(
                p =>
                    p.name.toLowerCase().includes(query) ||
                    p.id.toLowerCase().includes(query) ||
                    p.description.toLowerCase().includes(query)
            )
            .slice(0, 8);
    }, [search, params.data]);

    function go(path: string) {
        setOpen(false);
        setSearch('');
        navigate({ to: path });
    }

    return (
        <Command.Dialog
            open={open}
            onOpenChange={setOpen}
            label="Command palette"
            filter={scoreItem}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
        >
            <div className="w-full max-w-xl rounded-lg border border-default bg-surface-raised shadow-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 border-b border-subtle">
                    <Search size={16} className="text-fg-soft shrink-0" aria-hidden />
                    <Command.Input
                        value={search}
                        onValueChange={setSearch}
                        placeholder="Search screens and parameters..."
                        className="flex-1 bg-transparent py-3 text-sm text-fg outline-none placeholder:text-fg-soft"
                    />
                </div>
                <Command.List className="max-h-80 overflow-y-auto p-2">
                    <Command.Empty className="px-2 py-6 text-center text-sm text-fg-soft">
                        No matches.
                    </Command.Empty>

                    <Command.Group
                        heading="Go to"
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-soft"
                    >
                        {destinations.map(dest => {
                            const Icon = dest.icon;
                            const section = findSection(dest.section);
                            return (
                                <Command.Item
                                    key={dest.path}
                                    value={itemValue(dest.label, section?.label, dest.keywords?.join(' '))}
                                    onSelect={() => go(dest.path)}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-fg cursor-pointer data-[selected=true]:bg-[var(--sw-active)]"
                                >
                                    <Icon size={15} className="text-fg-soft shrink-0" aria-hidden />
                                    <span>{dest.label}</span>
                                    <span className="ml-auto text-xs text-fg-soft">{section?.label}</span>
                                </Command.Item>
                            );
                        })}
                    </Command.Group>

                    {paramMatches.length > 0 && (
                        <Command.Group
                            heading="Parameters"
                            className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-soft"
                        >
                            {paramMatches.map(param => (
                                <Command.Item
                                    key={param.id}
                                    value={itemValue(param.name, param.id, param.group)}
                                    onSelect={() => go(`/generate?focus=${encodeURIComponent(param.id)}`)}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-fg cursor-pointer data-[selected=true]:bg-[var(--sw-active)]"
                                >
                                    <span className="truncate">{param.name}</span>
                                    <span className="ml-auto shrink-0 font-mono text-xs text-fg-soft">
                                        {param.group ?? 'ungrouped'}
                                    </span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}
                </Command.List>
            </div>
        </Command.Dialog>
    );
}

/** The hint chip in the header that tells people the palette exists. */
export function CommandPaletteHint() {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
    return (
        <button
            type="button"
            onClick={() => {
                document.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'k',
                        ctrlKey: !isMac,
                        metaKey: isMac,
                        bubbles: true
                    })
                );
            }}
            className="flex items-center gap-2 rounded border border-default bg-surface px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
        >
            <Search size={13} aria-hidden />
            <span>Search</span>
            <kbd className="font-mono text-[10px] border border-subtle rounded px-1">
                {isMac ? 'Cmd' : 'Ctrl'}K
            </kbd>
        </button>
    );
}
