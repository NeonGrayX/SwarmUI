import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref, type TextareaHTMLAttributes } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { api } from '@/api/client';
import { useSession, useT2IParams } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import type { ListT2IParamsResponse } from '@/api/types';
import { useTranslation } from '@/i18n';
import { useMyUserData } from '@/library/hooks';
import { moveCommaSeparatedTag, shiftPromptWeight, type PromptEdit } from '@/params/promptEdit';
import { PromptCompleter, parseWordList, type CompletionSources, type NamedModel, type Suggestion, type WordEntry } from '@/params/promptComplete';
import { cleanModelName } from '@/params/schema';
import { useUserSetting } from '@/settings/useUserSetting';

/** Booru tag category colours, by category number. Same as the legacy `.tag-type-N` classes
 *  (src/wwwroot/css/site.css:815), blended into the text colour the same way. */
const TAG_COLORS = ['#009be6', '#ff8a8b', '#009b9b', '#c797ff', '#35c64a', '#ead084', '#7c4444', '#3a753a', '#41419b', '#a03fa0'];

/** Keys that move the caret, after which the open suggestions no longer describe where it is. */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** A parsed word list per GetMyUserData answer, so several prompt boxes share one parse of what can
 *  be a list hundreds of thousands of tags long. */
const parsedWordLists = new WeakMap<string[], WordEntry[]>();

function wordListOf(raw: string[] | null | undefined): WordEntry[] | null {
    if (!raw) {
        return null;
    }
    let parsed = parsedWordLists.get(raw);
    if (!parsed) {
        parsed = parseWordList(raw) ?? [];
        parsedWordLists.set(raw, parsed);
    }
    return parsed;
}

function namedModels(data: ListT2IParamsResponse | undefined, subtype: string): NamedModel[] {
    return (data?.models[subtype] ?? []).map(([name, arch]) => {
        const compatClass = arch ? data?.model_classes[arch]?.compat_class : null;
        return { name: cleanModelName(name), badge: compatClass ? data?.model_compat_classes[compatClass]?.short_code || null : null };
    });
}

/** A wildcard file's usable lines: trimmed, `#` comments cut, blanks dropped. Null if unreadable.
 *  Mirrors getWildcardDataFor (src/wwwroot/js/genpage/gentab/wildcards.js:372). */
async function fetchWildcardLines(name: string): Promise<string[] | null> {
    try {
        const data = await api.post<{ raw?: string }>('DescribeModel', { subtype: 'Wildcards', modelName: name });
        if (typeof data.raw !== 'string') {
            return null;
        }
        return data.raw
            .split('\n')
            .map(line => {
                const comment = line.indexOf('#');
                return (comment === -1 ? line : line.substring(0, comment)).trim();
            })
            .filter(Boolean);
    }
    catch {
        return null;
    }
}

/** Everything prompt suggestions are drawn from, and the settings the hotkeys read. `onWildcardLoaded`
 *  is called when a wildcard's lines, asked for while still loading, arrive. */
function usePromptSources(onWildcardLoaded: () => void): { sources: CompletionSources; weightStep: number; tagMove: boolean } {
    const queryClient = useQueryClient();
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const userData = useMyUserData(session.isSuccess);
    const canDescribe = usePermission('fundamental_model_access');
    const matchMode = useUserSetting('autocomplete.matchmode', 'Bucketed');
    const sortMode = useUserSetting('autocomplete.sortmode', 'Active');
    const weightStep = Number(useUserSetting<unknown>('ui.weightstep', 0.1));
    const tagMove = useUserSetting<unknown>('ui.tagmovehotkeyenabled', false);
    const loaded = useRef(onWildcardLoaded);
    loaded.current = onWildcardLoaded;

    const sources = useMemo((): CompletionSources => {
        const data = params.data;
        return {
            words: wordListOf(userData.data?.autocompletions),
            matchMode,
            sortMode,
            wildcards: data?.wildcards ?? [],
            wildcardLines: name => {
                if (!canDescribe) {
                    return null;
                }
                const key = ['wildcard-lines', name];
                const cached = queryClient.getQueryData<string[] | null>(key);
                if (cached !== undefined) {
                    return cached;
                }
                void queryClient
                    .fetchQuery({ queryKey: key, queryFn: () => fetchWildcardLines(name), staleTime: 60_000 })
                    .then(() => loaded.current());
                return undefined;
            },
            presets: (userData.data?.presets ?? []).map(preset => preset.title),
            embeddings: namedModels(data, 'Embedding'),
            loras: namedModels(data, 'LoRA'),
            yoloModels: data?.list.find(param => param.id === 'yolomodelinternal')?.values ?? []
        };
    }, [params.data, userData.data, matchMode, sortMode, canDescribe, queryClient]);

    return {
        sources,
        weightStep: Number.isFinite(weightStep) && weightStep > 0 ? weightStep : 0.1,
        tagMove: tagMove === true || tagMove === 'true'
    };
}

/** Event a prompt textarea answers by listing suggestions for its caret, for code that writes into
 *  the box and wants the list up as though it had been typed (eg the prompt tools' "Other..."). */
const SUGGEST_EVENT = 'sw:prompt-suggest';

/** Opens a prompt textarea's suggestions for where its caret is now. */
export function openPromptSuggestions(box: HTMLTextAreaElement): void {
    box.dispatchEvent(new Event(SUGGEST_EVENT));
}

export interface PromptTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
    ref?: Ref<HTMLTextAreaElement>;
    value: string;
    onValueChange: (value: string) => void;
}

/** A prompt textarea with the legacy prompt box's keyboard support (textPromptAddKeydownHandler,
 *  src/wwwroot/js/site.js:355):
 *   - Ctrl+Up/Down raises or lowers the weight of the selection, or of the word at the caret, by
 *     the user's UI.WeightStep setting, writing `<weight[1.2]:text>`.
 *   - Alt+Left/Right moves the comma-separated tag at the caret, when UI.TagMoveHotkeyEnabled is on.
 *   - Typing `<` lists the prompt syntax tags, and inside a tag, its values or a hint on how to use
 *     it; otherwise words from the user's autocompletion list are suggested. Up/Down picks,
 *     Tab/Enter accepts, Escape dismisses.
 *  Any `onKeyDown` passed in runs after these, for keys they leave alone. */
export function PromptTextarea({ ref, value, onValueChange, onKeyDown, ...rest }: PromptTextareaProps) {
    const { t } = useTranslation();
    const listId = useId();
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const [completer] = useState(() => new PromptCompleter());
    /** Selection to restore once a programmatic edit has been rendered back into the box. */
    const pendingSelection = useRef<[number, number] | null>(null);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [active, setActive] = useState(-1);

    const setRefs = useCallback(
        (node: HTMLTextAreaElement | null) => {
            inner.current = node;
            if (typeof ref === 'function') {
                ref(node);
            }
            else if (ref) {
                ref.current = node;
            }
        },
        [ref]
    );

    const close = () => {
        setSuggestions([]);
        setActive(-1);
    };

    const sourcesRef = useRef<CompletionSources | null>(null);
    const suggest = (text: string, caret: number) => {
        if (!sourcesRef.current) {
            return;
        }
        const result = completer.complete(text, caret, sourcesRef.current);
        setSuggestions(result.suggestions);
        setActive(result.suggestions.findIndex(s => s.apply !== undefined));
    };
    const { sources, weightStep, tagMove } = usePromptSources(() => {
        const box = inner.current;
        if (box && document.activeElement === box) {
            suggest(box.value, box.selectionStart);
        }
    });
    sourcesRef.current = sources;
    const suggestRef = useRef(suggest);
    suggestRef.current = suggest;

    useEffect(() => {
        const box = inner.current;
        if (!box) {
            return;
        }
        const onSuggest = () => suggestRef.current(box.value, box.selectionStart);
        box.addEventListener(SUGGEST_EVENT, onSuggest);
        return () => box.removeEventListener(SUGGEST_EVENT, onSuggest);
    }, []);

    useLayoutEffect(() => {
        const selection = pendingSelection.current;
        if (selection && inner.current) {
            inner.current.setSelectionRange(selection[0], selection[1]);
            pendingSelection.current = null;
        }
    }, [value]);

    const applyEdit = (edit: PromptEdit) => {
        const box = inner.current;
        if (!box) {
            return;
        }
        if (edit.text === box.value) {
            box.setSelectionRange(edit.selStart, edit.selEnd);
            return;
        }
        pendingSelection.current = [edit.selStart, edit.selEnd];
        onValueChange(edit.text);
    };

    const accept = (suggestion: Suggestion) => {
        const box = inner.current;
        if (!box || suggestion.apply === undefined) {
            return;
        }
        const before = box.value.substring(0, suggestion.from) + suggestion.apply;
        const text = before + box.value.substring(box.selectionStart);
        applyEdit({ text, selStart: before.length, selEnd: before.length });
        box.focus();
        // Accepting `<wildcard:` goes straight on to listing the wildcards, and so on.
        suggest(text, before.length);
    };

    const pickable = suggestions.some(s => s.apply !== undefined);
    const open = suggestions.length > 0;

    const moveActive = (delta: number) => {
        const count = suggestions.length;
        let next = active;
        for (let i = 0; i < count; i++) {
            next = (next + delta + count) % count;
            if (suggestions[next].apply !== undefined) {
                break;
            }
        }
        setActive(next);
        document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Safari reports the Enter that confirms an IME composition with isComposing already false,
        // but keyCode 229, and that Enter must not reach the generate shortcut.
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
            return;
        }
        const box = e.currentTarget;
        const plain = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
        if (open && pickable && plain) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveActive(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if ((e.key === 'Tab' || e.key === 'Enter') && suggestions[active]) {
                e.preventDefault();
                accept(suggestions[active]);
                return;
            }
        }
        if (open && e.key === 'Escape') {
            e.preventDefault();
            close();
            return;
        }
        if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            close();
            const edit = shiftPromptWeight(box.value, box.selectionStart, box.selectionEnd, e.key === 'ArrowUp', weightStep);
            if (edit) {
                applyEdit(edit);
            }
            return;
        }
        if (tagMove && e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            close();
            const edit = moveCommaSeparatedTag(box.value, box.selectionStart, box.selectionEnd, e.key === 'ArrowLeft');
            if (edit) {
                applyEdit(edit);
            }
            return;
        }
        if (open && CARET_KEYS.has(e.key)) {
            close();
        }
        onKeyDown?.(e);
    };

    return (
        <Popover.Root
            open={open}
            onOpenChange={next => {
                if (!next) {
                    close();
                }
            }}
        >
            <Popover.Anchor asChild>
                <textarea
                    {...rest}
                    ref={setRefs}
                    value={value}
                    aria-autocomplete="list"
                    aria-controls={open ? listId : undefined}
                    aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
                    onChange={e => {
                        onValueChange(e.target.value);
                        suggest(e.target.value, e.target.selectionStart);
                    }}
                    onKeyDown={handleKeyDown}
                />
            </Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    // Focus stays in the textarea: typing carries on while the list is open.
                    onOpenAutoFocus={e => e.preventDefault()}
                    onCloseAutoFocus={e => e.preventDefault()}
                    onMouseDown={e => e.preventDefault()}
                    className="z-50 max-h-[min(16rem,var(--radix-popover-content-available-height))] w-max min-w-[min(16rem,var(--radix-popover-trigger-width))] max-w-[min(40rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                >
                    <div id={listId} role="listbox" aria-label={t('generate.prompt.suggestions')}>
                        {suggestions.map((suggestion, i) =>
                            suggestion.apply === undefined ? (
                                <div key={i} className="whitespace-pre-line px-2 py-1 text-xs text-fg-soft">
                                    {suggestion.detail}
                                </div>
                            ) : (
                                <div
                                    key={i}
                                    id={`${listId}-${i}`}
                                    role="option"
                                    aria-selected={i === active}
                                    onClick={() => accept(suggestion)}
                                    className={[
                                        'flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-sm',
                                        i === active ? 'bg-[var(--sw-active)] text-fg-strong' : 'text-fg hover:bg-[var(--sw-hover)]'
                                    ].join(' ')}
                                >
                                    <span
                                        className="shrink-0"
                                        style={
                                            suggestion.tag !== null && TAG_COLORS[Number(suggestion.tag)]
                                                ? { color: `color-mix(in srgb, var(--text) 80%, ${TAG_COLORS[Number(suggestion.tag)]})` }
                                                : undefined
                                        }
                                    >
                                        {suggestion.label}
                                    </span>
                                    {suggestion.detail && <span className="min-w-0 text-xs text-fg-soft">- {suggestion.detail}</span>}
                                    {suggestion.badge && <span className="ml-auto shrink-0 pl-2 text-[10px] text-fg-soft">{suggestion.badge}</span>}
                                </div>
                            )
                        )}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
