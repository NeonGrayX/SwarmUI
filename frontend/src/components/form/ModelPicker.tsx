import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ChevronDown, Star, X } from 'lucide-react';
import {
    isArchCompatible,
    subtypeNoun,
    subtypeUsesCompat,
    useCurrentModel,
    useModelCatalog,
    type ModelOption
} from '@/library/catalog';
import { useToggleStar } from '@/library/hooks';
import {
    PickerCard,
    PickerChip,
    PickerGroup,
    PickerRow,
    PickerSearch,
    PickerStar,
    PickerThumb,
    PickerViewToggle
} from './PickerParts';
import type { ViewMode } from '@/library/types';
import { t as translate, useTranslation } from '@/i18n';

/** Model pickers for every `model`-typed parameter: search, preview thumbnails, and filters over
 *  what can be a library of a thousand files.
 *
 * The compatibility filter is the important one - it hides models that cannot work with whatever
 * base model is currently selected (see `isArchCompatible` in src/library/catalog.ts).
 */

/** Filter state worth remembering between openings. Kept out of the query cache because it is
 *  interface preference, not server state. */
interface PickerPrefs {
    view: ViewMode;
    /** Per-subtype state of the compatibility filter. */
    fits: Record<string, boolean>;
    starredOnly: boolean;
    setView: (view: ViewMode) => void;
    setFits: (subtype: string, on: boolean) => void;
    setStarredOnly: (on: boolean) => void;
}

const usePickerPrefs = create<PickerPrefs>()(
    persist(
        set => ({
            view: 'grid',
            fits: {},
            starredOnly: false,
            setView: view => set({ view }),
            setFits: (subtype, on) => set(state => ({ fits: { ...state.fits, [subtype]: on } })),
            setStarredOnly: starredOnly => set({ starredOnly })
        }),
        { name: 'swarm-ui-model-picker' }
    )
);

const TRIGGER_CLASS =
    'flex w-full items-center gap-2 rounded border border-default bg-surface-sunken text-left ' +
    'text-fg outline-none hover:border-[var(--emphasis)] focus:border-[var(--emphasis)] ' +
    'disabled:cursor-not-allowed disabled:opacity-60';

const SELECT_CLASS =
    'rounded-full border border-default bg-surface-sunken px-1.5 py-0.5 text-xs text-fg-soft ' +
    'outline-none focus:border-[var(--emphasis)]';

/** Single-select model field. */
export function ModelPicker(props: {
    id?: string;
    subtype: string;
    value: string;
    onChange: (name: string) => void;
    disabled?: boolean;
    /** Fetches metadata immediately rather than on first open. For pickers that are always on
     *  screen, where a thumbnail beside the current model is worth the one request. */
    eager?: boolean;
    /** Slimmer trigger, for the context strip. */
    compact?: boolean;
    /** Noun for the search placeholder and empty states. Defaults to the subtype's own. */
    noun?: string;
    /** The value that means "nothing picked". Empty for the main model, but the add-on params use
     *  a sentinel instead - VAE defaults to the literal "None" (T2IParamTypes.cs:692) - and that
     *  is not a file, so it must not be read as a model this server is missing. */
    emptyValue?: string;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    // Metadata is fetched from the first open onward: closing must not drop it, or every reopen
    // would flash empty thumbnails.
    const [everOpened, setEverOpened] = useState(false);
    const catalog = useModelCatalog(props.subtype, props.eager || everOpened);
    const noun = props.noun ?? subtypeNoun(props.subtype);

    const empty = props.emptyValue ?? '';
    const hasValue = props.value !== '' && props.value !== empty;
    const option = hasValue ? catalog.byName.get(props.value) : undefined;
    // Only a loaded list can prove a name wrong: before the schema arrives every value looks
    // unknown, and a flash of "missing" on a perfectly good model is worse than saying nothing.
    const missing = hasValue && catalog.options.length > 0 && !option;

    return (
        <Popover.Root
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (next) {
                    setEverOpened(true);
                }
            }}
        >
            <Popover.Trigger asChild>
                <button
                    type="button"
                    id={props.id}
                    disabled={props.disabled}
                    title={hasValue ? props.value : undefined}
                    className={[
                        TRIGGER_CLASS,
                        props.compact ? 'py-0.5 pl-1 pr-1.5 text-xs' : 'py-1 pl-1 pr-2 text-sm',
                        missing ? 'border-[var(--sw-error-border)]' : ''
                    ].join(' ')}
                >
                    <ModelThumb option={option} size={props.compact ? 'xs' : 'sm'} />
                    <span className={['min-w-0 flex-1 truncate', hasValue ? '' : 'text-fg-soft'].join(' ')}>
                        {hasValue
                            ? (option?.title ?? props.value)
                            : catalog.options.length === 0
                              ? t('modelPicker.noneInstalled', { noun })
                              : t('modelPicker.noneSelected')}
                    </span>
                    {missing && (
                        <span
                            title={t('modelPicker.missingTitle', { name: props.value })}
                            className="shrink-0 text-xs"
                            style={{ color: 'var(--backend-errored)' }}
                        >
                            {t('modelPicker.missing')}
                        </span>
                    )}
                    <ShortCode option={option} />
                    <ChevronDown size={13} aria-hidden className="shrink-0 text-fg-soft" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                    className="z-50 w-[min(28rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl"
                >
                    <ModelOptionList
                        subtype={props.subtype}
                        noun={noun}
                        selected={hasValue ? [props.value] : []}
                        onPick={picked => {
                            props.onChange(picked.name);
                            setOpen(false);
                        }}
                        onClear={
                            hasValue
                                ? () => {
                                      props.onChange(empty);
                                      setOpen(false);
                                  }
                                : undefined
                        }
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** The searchable, filterable body of a picker. Shared by the single-select field above and the
 *  LoRA picker's add-popover, so both offer the same filters. */
export function ModelOptionList(props: {
    subtype: string;
    /** Names already chosen, shown with a check. */
    selected: string[];
    onPick: (option: ModelOption) => void;
    /** Present for single-select: renders the row that clears the value. */
    onClear?: () => void;
    noun: string;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [arch, setArch] = useState('all');
    const [folder, setFolder] = useState('all');
    const prefs = usePickerPrefs();
    const catalog = useModelCatalog(props.subtype);
    const current = useCurrentModel();
    const toggleStar = useToggleStar();

    const usesCompat = subtypeUsesCompat(props.subtype);
    // Add-ons default to hiding what cannot work; base models have nothing to be matched against.
    const fits = (prefs.fits[props.subtype] ?? usesCompat) && usesCompat && current.compatClass !== null;
    const chosen = useMemo(() => new Set(props.selected), [props.selected]);

    const { options } = catalog;

    /** Every filter except the compatibility one, so the count of what it hides can be shown. */
    const preCompat = useMemo(() => {
        const query = search.trim().toLowerCase();
        return options.filter(option => {
            if (prefs.starredOnly && !option.starred) {
                return false;
            }
            if (arch !== 'all' && (option.compatClass ?? '') !== arch) {
                return false;
            }
            if (folder !== 'all' && (option.folder.split('/')[0] ?? '') !== folder) {
                return false;
            }
            if (!query) {
                return true;
            }
            const haystack = `${option.name} ${option.title} ${option.className ?? ''} ${option.tags.join(' ')}`;
            return haystack.toLowerCase().includes(query);
        });
    }, [options, search, prefs.starredOnly, arch, folder]);

    const matches = useMemo(() => {
        const query = search.trim().toLowerCase();
        const shown = fits
            ? preCompat.filter(option => isArchCompatible(option, current.compatClass))
            : preCompat;
        if (!query) {
            return shown;
        }
        // Name hits beat metadata hits, and a leading match beats one buried mid-name, so typing
        // "juggernaut" lands on the model rather than on something merely tagged with it.
        const rank = (option: ModelOption) => {
            const leaf = option.leaf.toLowerCase();
            if (leaf.startsWith(query)) {
                return 0;
            }
            if (leaf.includes(query)) {
                return 1;
            }
            return option.name.toLowerCase().includes(query) ? 2 : 3;
        };
        return [...shown].sort(
            (a, b) => rank(a) - rank(b) || Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name)
        );
    }, [preCompat, fits, current.compatClass, search]);

    const hiddenByCompat = preCompat.length - matches.length;

    const archOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const option of options) {
            if (option.compatClass && !seen.has(option.compatClass)) {
                seen.set(option.compatClass, option.shortCode || option.compatClass);
            }
        }
        return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
    }, [options]);

    const folderOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const option of options) {
            const top = option.folder.split('/')[0];
            if (top) {
                seen.add(top);
            }
        }
        return [...seen].sort((a, b) => a.localeCompare(b));
    }, [options]);

    return (
        <Command shouldFilter={false} loop label={t('modelPicker.chooseLabel', { noun: props.noun })}>
            <div className="border-b border-subtle p-2">
                <PickerSearch
                    value={search}
                    onChange={setSearch}
                    placeholder={t('modelPicker.searchPlaceholder', { noun: props.noun })}
                />

                <div className="mt-2 flex flex-wrap items-center gap-1">
                    {usesCompat && current.compatClass && (
                        <PickerChip
                            pressed={fits}
                            onToggle={() => prefs.setFits(props.subtype, !fits)}
                            title={t('modelPicker.fitsHint', {
                                noun: props.noun,
                                model: current.label ?? current.compatClass ?? ''
                            })}
                            label={t('modelPicker.fitsChip', {
                                model: current.label ?? t('modelPicker.fitsFallback')
                            })}
                        />
                    )}
                    <PickerChip
                        pressed={prefs.starredOnly}
                        onToggle={() => prefs.setStarredOnly(!prefs.starredOnly)}
                        title={t('modelPicker.starredOnlyHint')}
                        label={t('modelPicker.starred')}
                    >
                        <Star size={11} aria-hidden fill={prefs.starredOnly ? 'currentColor' : 'none'} />
                    </PickerChip>
                    {archOptions.length > 1 && (
                        <select
                            value={arch}
                            onChange={e => setArch(e.target.value)}
                            aria-label={t('modelPicker.filterByArchitecture')}
                            className={SELECT_CLASS}
                        >
                            <option value="all">{t('modelPicker.allArchitectures')}</option>
                            {archOptions.map(([id, label]) => (
                                <option key={id} value={id}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    )}
                    {folderOptions.length > 0 && (
                        <select
                            value={folder}
                            onChange={e => setFolder(e.target.value)}
                            aria-label={t('modelPicker.filterByFolder')}
                            className={SELECT_CLASS}
                        >
                            <option value="all">{t('modelPicker.allFolders')}</option>
                            {folderOptions.map(name => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    )}
                    <div className="flex-1" />
                    <PickerViewToggle view={prefs.view} onView={prefs.setView} />
                </div>
            </div>

            <Command.List className="max-h-80 overflow-y-auto p-2">
                {matches.length === 0 && (
                    <p className="px-2 py-6 text-center text-sm text-fg-soft">
                        {options.length === 0
                            ? t('modelPicker.noneInstalledLong', { noun: props.noun })
                            : t('modelPicker.noFilterMatches', { noun: props.noun })}
                    </p>
                )}

                <PickerGroup view={prefs.view}>
                    {matches.map(option => {
                        const incompatible =
                            usesCompat &&
                            current.compatClass !== null &&
                            !isArchCompatible(option, current.compatClass);
                        // Starring keys off the file name the model routes use, so it is offered
                        // only for entries ListModels actually described.
                        const rawName = option.rawName;
                        const shared = {
                            option,
                            incompatible,
                            picked: chosen.has(option.name),
                            onPick: () => props.onPick(option),
                            onStar: rawName
                                ? () => toggleStar.mutate({ bucket: props.subtype, name: rawName })
                                : undefined
                        };
                        return prefs.view === 'grid' ? (
                            <OptionCard key={option.name} {...shared} />
                        ) : (
                            <OptionRow key={option.name} {...shared} />
                        );
                    })}
                </PickerGroup>
            </Command.List>

            <div className="flex items-center gap-2 border-t border-subtle px-3 py-1.5 text-xs text-fg-soft">
                <span>{t('modelPicker.countOf', { shown: matches.length, total: options.length })}</span>
                {hiddenByCompat > 0 && (
                    <button
                        type="button"
                        onClick={() => prefs.setFits(props.subtype, false)}
                        className="rounded px-1.5 py-0.5 hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        {t('modelPicker.showNonFitting', { count: hiddenByCompat })}
                    </button>
                )}
                <div className="flex-1" />
                {catalog.loadingDetails && <span>{t('modelPicker.loadingDetails')}</span>}
                {/* Clearing lives here rather than as a row in the list: cmdk keeps the first item
                    highlighted, so a "none" row at the top would be what Enter picks after a
                    search - the one result nobody typing a model name is looking for. */}
                {props.onClear && (
                    <button
                        type="button"
                        onClick={props.onClear}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        <X size={11} aria-hidden />
                        {t('modelPicker.clearSelection')}
                    </button>
                )}
            </div>
        </Command>
    );
}

interface EntryProps {
    option: ModelOption;
    picked: boolean;
    incompatible: boolean;
    onPick: () => void;
    onStar?: () => void;
}

function OptionCard(props: EntryProps) {
    const { option } = props;
    return (
        <PickerCard
            value={option.name}
            onPick={props.onPick}
            tooltip={describe(option, props.incompatible)}
            picked={props.picked}
            preview={option.preview}
            title={option.title}
            subtitle={option.folder || option.className}
            badge={
                option.shortCode && (
                    <span
                        className="absolute bottom-1 right-1 rounded px-1 text-[10px]"
                        style={
                            props.incompatible
                                ? { background: 'var(--sw-danger-surface)', color: 'var(--backend-errored)' }
                                : { background: 'var(--sw-chip-bg)', color: 'var(--text)' }
                        }
                    >
                        {option.shortCode}
                    </span>
                )
            }
            marks={option.loaded && <LoadedDot />}
            actions={<PickerStar starred={option.starred} onStar={props.onStar} overlay />}
        />
    );
}

function OptionRow(props: EntryProps) {
    const { option } = props;
    return (
        <PickerRow
            value={option.name}
            onPick={props.onPick}
            tooltip={describe(option, props.incompatible)}
            picked={props.picked}
            preview={option.preview}
            title={option.leaf}
            subtitle={option.folder}
            trailing={
                <>
                    {option.loaded && <LoadedDot />}
                    <ShortCode option={option} incompatible={props.incompatible} />
                </>
            }
            actions={<PickerStar starred={option.starred} onStar={props.onStar} />}
        />
    );
}

/** Preview thumbnail, or a neutral placeholder so rows keep a stable rhythm. */
export function ModelThumb(props: { option: ModelOption | undefined; size: 'xs' | 'sm' }) {
    return <PickerThumb preview={props.option?.preview} size={props.size} />;
}

/** Compat-family badge, eg 'SDXL'. Turns to the error colour when the entry cannot work with the
 *  base model that is currently selected. */
function ShortCode(props: { option: ModelOption | undefined; incompatible?: boolean }) {
    if (!props.option?.shortCode) {
        return null;
    }
    return (
        <span
            className="shrink-0 rounded px-1 text-[10px]"
            style={
                props.incompatible
                    ? { background: 'var(--sw-danger-surface)', color: 'var(--backend-errored)' }
                    : { background: 'var(--sw-chip-bg)', color: 'var(--text)' }
            }
        >
            {props.option.shortCode}
        </span>
    );
}

function LoadedDot() {
    return (
        <span
            title={translate('modelPicker.loadedOnBackend')}
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--backend-running)' }}
        />
    );
}


/** Hover text: everything known about the entry that the row itself has no room for. */
function describe(option: ModelOption, incompatible: boolean): string {
    const lines = [option.name];
    if (option.className) {
        lines.push(option.className);
    }
    if (option.triggerPhrase) {
        lines.push(translate('modelPicker.trigger', { phrase: option.triggerPhrase }));
    }
    if (incompatible) {
        lines.push(translate('modelPicker.incompatible'));
    }
    return lines.join('\n');
}
