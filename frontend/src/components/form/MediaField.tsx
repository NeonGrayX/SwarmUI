import { useRef, useState } from 'react';
import { ImagePlus, Plus, X } from 'lucide-react';
import { useSession } from '@/api/hooks';
import { imageOutPrefix } from '@/library/types';
import { useParamStore } from '@/params/store';
import {
    acceptsFile,
    describeMedia,
    fileToDataUrl,
    isMediaListType,
    kindOfValue,
    mediaKindOf,
    mediaSrc,
    mediaValues,
    FILE_ACCEPT,
    type MediaKind,
    type MediaMeta
} from '@/params/media';
import type { ControlProps } from './controls';

const NO_META: MediaMeta[] = [];

/** File input for image / audio / video params, single or list.
 *
 * Accepts a file three ways - picker, drag and drop, clipboard paste - where the legacy UI splits
 * these across a hidden `<input type=file>`, a separate zero-width "Ctrl+V: Paste Image" text box,
 * and an `Upload` anchor (makeImageInput, src/wwwroot/js/site.js:990). The preview replaces the
 * whole control here rather than hanging below it, so a set input reads as set at a glance.
 *
 * Values are stored as `data:` URLs; the server strips the prefix when parsing
 * (T2IParamTypes.cs:1113). Server-side paths (`inputs/…`, `raw/…`) set from elsewhere are kept
 * as-is, since those are reusable across sessions and far cheaper to send. */
export function MediaField(props: ControlProps & { emptyLabel?: string }) {
    const { param } = props;
    const kind = mediaKindOf(param.type);
    const multiple = isMediaListType(param.type);
    const values = mediaValues(props.value);

    const metas = useParamStore(s => s.media[param.id]) ?? NO_META;
    const setMedia = useParamStore(s => s.setMedia);
    const session = useSession();
    const outPrefix = imageOutPrefix(session.data?.user_id, session.data?.output_append_user);

    const fileRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function commit(nextValues: string[], nextMetas: MediaMeta[]): void {
        setMedia(param.id, nextMetas);
        props.onChange(multiple ? nextValues : (nextValues[0] ?? ''));
    }

    async function addFiles(files: FileList | File[] | null | undefined): Promise<void> {
        if (props.disabled || !files) {
            return;
        }
        const incoming = [...files];
        const accepted = incoming.filter(file => acceptsFile(kind, file));
        if (accepted.length === 0) {
            setError(incoming.length > 0 ? `Not a usable ${kind} file.` : null);
            return;
        }
        setError(null);
        try {
            const added = await Promise.all(
                accepted.map(async file => {
                    const data = await fileToDataUrl(file);
                    return { data, meta: { name: file.name, kind: kindOfValue(data, kind) } as MediaMeta };
                })
            );
            if (multiple) {
                commit(
                    [...values, ...added.map(entry => entry.data)],
                    [...filledMetas(values, metas, kind), ...added.map(entry => entry.meta)]
                );
            }
            else {
                const last = added[added.length - 1];
                commit([last.data], [last.meta]);
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Could not read that file.');
        }
    }

    function remove(index: number): void {
        const filled = filledMetas(values, metas, kind);
        commit(
            values.filter((_, i) => i !== index),
            filled.filter((_, i) => i !== index)
        );
    }

    /** Records what a preview learned once it loaded: resolution for visual media, duration for
     *  timed media. Both end up in the generation metadata, as they do in the legacy UI. */
    function patchMeta(index: number, patch: Partial<MediaMeta>): void {
        const filled = filledMetas(values, metas, kind);
        const current = filled[index];
        if (!current || (Object.keys(patch) as (keyof MediaMeta)[]).every(key => current[key] === patch[key])) {
            return;
        }
        filled[index] = { ...current, ...patch };
        setMedia(param.id, filled);
    }

    function onDrop(event: React.DragEvent): void {
        event.preventDefault();
        setDragging(false);
        void addFiles(event.dataTransfer?.files);
    }

    return (
        <div
            onDragOver={event => {
                if (!props.disabled) {
                    event.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onPaste={event => void addFiles(event.clipboardData?.files)}
            tabIndex={props.disabled ? -1 : 0}
            aria-label={`${param.name}: drop or paste ${article(kind)} ${kind}`}
            className={[
                'rounded border outline-none transition-colors',
                dragging ? 'border-[var(--emphasis)] bg-[var(--sw-hover)]' : 'border-transparent',
                'focus-visible:border-[var(--emphasis)]'
            ].join(' ')}
        >
            <input
                ref={fileRef}
                id={props.inputId}
                type="file"
                className="sr-only"
                accept={FILE_ACCEPT[kind]}
                multiple={multiple}
                disabled={props.disabled}
                onChange={event => {
                    void addFiles(event.target.files);
                    // Clear, so picking the same file twice in a row still fires a change.
                    event.target.value = '';
                }}
            />

            {values.length === 0 ? (
                <EmptyZone
                    kind={kind}
                    label={props.emptyLabel}
                    disabled={props.disabled}
                    onClick={() => fileRef.current?.click()}
                />
            ) : multiple ? (
                <div className="grid grid-cols-3 gap-1">
                    {values.map((value, index) => (
                        <Tile
                            key={`${index}-${value.slice(0, 32)}`}
                            value={value}
                            meta={metas[index]}
                            kind={kind}
                            outPrefix={outPrefix}
                            disabled={props.disabled}
                            onRemove={() => remove(index)}
                            onLoaded={patch => patchMeta(index, patch)}
                        />
                    ))}
                    {!props.disabled && (
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            title={`Add ${kind}`}
                            className="flex aspect-square items-center justify-center rounded border border-dashed border-default text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <Plus size={16} aria-hidden />
                        </button>
                    )}
                </div>
            ) : (
                <Single
                    value={values[0]}
                    meta={metas[0]}
                    kind={kind}
                    outPrefix={outPrefix}
                    disabled={props.disabled}
                    onRemove={() => remove(0)}
                    onReplace={() => fileRef.current?.click()}
                    onLoaded={patch => patchMeta(0, patch)}
                />
            )}

            {error && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {error}
                </p>
            )}
        </div>
    );
}

function EmptyZone(props: { kind: MediaKind; label?: string; disabled?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-default px-2 py-3 text-xs text-fg-soft transition-colors hover:text-fg hover:bg-[var(--sw-hover)] disabled:cursor-not-allowed"
        >
            <ImagePlus size={14} aria-hidden />
            {props.label ?? `Upload, drop, or paste ${article(props.kind)} ${props.kind}`}
        </button>
    );
}

interface PreviewProps {
    value: string;
    meta: MediaMeta | undefined;
    kind: MediaKind;
    outPrefix: string;
    disabled?: boolean;
    onRemove: () => void;
    onLoaded: (patch: Partial<MediaMeta>) => void;
}

function Single(props: PreviewProps & { onReplace: () => void }) {
    return (
        <div className="space-y-1">
            <div className="relative overflow-hidden rounded border border-default bg-surface-sunken">
                <Preview {...props} className="max-h-32 w-full object-contain" />
                {!props.disabled && <RemoveButton onClick={props.onRemove} />}
            </div>
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-fg-soft" title={props.meta?.name}>
                    {describeMedia(props.meta) || 'Loading…'}
                </span>
                {!props.disabled && (
                    <button
                        type="button"
                        onClick={props.onReplace}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        Replace
                    </button>
                )}
            </div>
        </div>
    );
}

function Tile(props: PreviewProps) {
    return (
        <div
            className="relative aspect-square overflow-hidden rounded border border-default bg-surface-sunken"
            title={describeMedia(props.meta)}
        >
            <Preview {...props} className="h-full w-full object-cover" />
            {!props.disabled && <RemoveButton onClick={props.onRemove} />}
        </div>
    );
}

function Preview(props: PreviewProps & { className: string }) {
    const src = mediaSrc(props.value, props.outPrefix);
    const kind = kindOfValue(props.value, props.kind);

    if (kind === 'audio') {
        return (
            <audio
                src={src}
                controls
                onLoadedMetadata={event => props.onLoaded({ duration: event.currentTarget.duration })}
                className="w-full p-1"
            />
        );
    }
    if (kind === 'video') {
        return (
            <video
                src={src}
                muted
                loop
                autoPlay
                playsInline
                onLoadedMetadata={event =>
                    props.onLoaded({
                        width: event.currentTarget.videoWidth,
                        height: event.currentTarget.videoHeight,
                        duration: event.currentTarget.duration
                    })
                }
                className={props.className}
            />
        );
    }
    return (
        <img
            src={src}
            alt={props.meta?.name ?? 'Input preview'}
            onLoad={event =>
                props.onLoaded({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight
                })
            }
            className={props.className}
        />
    );
}

function RemoveButton(props: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label="Remove"
            title="Remove"
            className="absolute right-1 top-1 rounded bg-surface/90 p-0.5 text-fg-soft hover:text-fg"
            style={{ border: '1px solid var(--light-border)' }}
        >
            <X size={12} aria-hidden />
        </button>
    );
}

/** Metadata array padded to match the values, so index-based edits never fall off the end.
 *  Values can arrive from outside this control (a preset, or "Use as init image"), in which case
 *  the name is all we can infer until the preview loads. */
function filledMetas(values: string[], metas: MediaMeta[], fallback: MediaKind): MediaMeta[] {
    return values.map(
        (value, index) =>
            metas[index] ?? { name: inferName(value), kind: kindOfValue(value, fallback) }
    );
}

function article(kind: MediaKind): string {
    return kind === 'video' ? 'a' : 'an';
}

function inferName(value: string): string {
    if (value.startsWith('data:')) {
        return 'pasted data';
    }
    return value.slice(value.lastIndexOf('/') + 1);
}
