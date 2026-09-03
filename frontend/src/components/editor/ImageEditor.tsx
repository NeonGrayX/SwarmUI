import { useCallback, useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Ellipsis, Maximize, Undo2, X } from 'lucide-react';
import { api } from '@/api/client';
import { useCurrentStatus, useSession } from '@/api/hooks';
import type { GenMessage } from '@/generate/types';
import { imageUrl } from '@/generate/store';
import { useGenInput } from '@/generate/input';
import { useParamStore } from '@/params/store';
import { useEditorEngine, useEditorStore, useEditorVersion } from '@/editor/store';
import { useIsCompact } from '@/shell/viewport';
import { ToolBar } from './ToolBar';
import { ToolOptions } from './ToolOptions';
import { LayerPanel } from './LayerPanel';
import { useTranslation } from '@/i18n';

/** The image editor, shown in place of the canvas while it is open.
 *
 * Recreates src/wwwroot/js/genpage/helpers/image_editor.js: layers, masking for inpainting, the
 * full tool set, and the generation wiring that makes the editor's output the init image and its
 * mask layers the inpaint mask.
 *
 * The engine draws the canvas itself; this component supplies the chrome around it, and the
 * services the engine cannot reach on its own - the API, the parameter store, the prompt. */
export function ImageEditor() {
    const { t } = useTranslation();
    const engine = useEditorEngine();
    const close = useEditorStore(s => s.close);
    const sourceName = useEditorStore(s => s.sourceName);
    useEditorVersion();

    const compact = useIsCompact();
    const hostRef = useRef<HTMLDivElement>(null);
    const [notice, setNotice] = useState<{ key: string; tone: 'ok' | 'error' } | null>(null);

    useEditorHost(setNotice);

    // The engine owns the canvas element and every listener on it, so mounting is one call.
    useEffect(() => {
        const host = hostRef.current;
        return host ? engine.attach(host) : undefined;
    }, [engine]);

    // A notice is an acknowledgement, not something to dismiss.
    useEffect(() => {
        if (notice) {
            const timer = setTimeout(() => setNotice(null), 3500);
            return () => clearTimeout(timer);
        }
    }, [notice]);

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-1">
                {/* On a phone the header has room for the controls or for the caption, not both,
                    and the controls are the half that does something. */}
                <h2 className="truncate text-xs font-medium text-fg-strong">
                    {t('editor.title')}
                    {sourceName && (
                        <span className="ml-1.5 hidden font-normal text-fg-soft sm:inline">{sourceName}</span>
                    )}
                </h2>
                <span className="hidden text-xs text-fg-soft tabular-nums sm:inline">
                    {Math.round(engine.realWidth)}×{Math.round(engine.realHeight)}
                </span>
                <div className="flex-1" />
                <HeaderButton
                    label={t('editor.undo')}
                    disabled={!engine.canUndo}
                    onClick={() => engine.undoOnce()}
                >
                    <Undo2 size={14} aria-hidden />
                </HeaderButton>
                <HeaderButton label={t('editor.fitView')} onClick={() => engine.autoZoom()}>
                    <Maximize size={14} aria-hidden />
                </HeaderButton>
                <OptionsMenu onNotice={setNotice} />
                <HeaderButton label={t('editor.close')} onClick={close}>
                    <X size={14} aria-hidden />
                </HeaderButton>
            </div>

            {/* Narrow screens run the layers along the bottom instead of down the side: a canvas
                is the one thing here that wants width, and a horizontal strip of thumbnails costs
                a fixed height rather than a quarter of it. */}
            <div className={`flex min-h-0 flex-1 ${compact ? 'flex-col' : ''}`}>
                <div className="flex min-h-0 min-w-0 flex-1">
                    <ToolBar compact={compact} />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" />
                        <ToolOptions />
                    </div>
                </div>
                <LayerPanel orientation={compact ? 'strip' : 'column'} />
            </div>

            {notice && (
                <p
                    role="status"
                    className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded border px-3 py-1.5 text-xs shadow-lg"
                    style={{
                        borderColor: notice.tone === 'ok' ? 'var(--backend-running)' : 'var(--sw-error-border)',
                        background: 'var(--sw-surface-raised)',
                        color: 'var(--text)'
                    }}
                >
                    {t(notice.key)}
                </p>
            )}
        </div>
    );
}

type NoticeSetter = (notice: { key: string; tone: 'ok' | 'error' } | null) => void;

/** Connects the engine to the application: backend features, the generation API, the prompt.
 *
 * Rebuilt on every render rather than memoized, because `buildGenInput` closes over the parameter
 * schema and the SAM2 tools must send *current* parameters, not the ones in force when the editor
 * opened. Assigning a plain object costs nothing; the engine only reads it when it fires. */
function useEditorHost(setNotice: NoticeSetter): void {
    const engine = useEditorEngine();
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const buildGenInput = useGenInput();
    const setValue = useParamStore(s => s.setValue);

    const runGeneration = useCallback(
        (body: Record<string, unknown>, onImage: (dataUrl: string) => void, onDone?: () => void) => {
            let finished = false;
            const done = () => {
                if (!finished) {
                    finished = true;
                    onDone?.();
                }
            };
            return api.stream<GenMessage>('GenerateText2ImageWS', body, {
                onMessage: message => {
                    // Results can arrive as a view path rather than inline data, which has to be
                    // made absolute: this UI is served from /ui/, so a relative path misresolves.
                    if (message.image) {
                        onImage(imageUrl(message.image) ?? message.image);
                    }
                },
                onError: done,
                onClose: done
            });
        },
        []
    );

    engine.host = {
        supportedFeatures: status.data?.supported_features ?? [],
        buildGenInput,
        runGeneration,
        notice: (key, tone) => setNotice({ key, tone }),
        onSam2Missing: () => setNotice({ key: 'editor.notice.sam2Missing', tone: 'error' }),
        appendToPrompt: text => {
            const current = String(useParamStore.getState().values.prompt ?? '');
            setValue('prompt', current + text);
        }
    };

    // The editor's canvas *is* the output resolution, so the width/height params drive it while it
    // is open - the same link the legacy UI makes from its width/height change handlers.
    const width = Number(useParamStore(s => s.values.width) ?? 0);
    const height = Number(useParamStore(s => s.values.height) ?? 0);
    useEffect(() => {
        if (width > 0 && height > 0) {
            engine.setOutputSize(width, height);
        }
    }, [engine, width, height]);
}

/** The overflow menu: exports, clipboard, and the whole-image autosegment. */
function OptionsMenu(props: { onNotice: NoticeSetter }) {
    const { t } = useTranslation();
    const engine = useEditorEngine();
    const buildGenInput = useGenInput();

    function download(dataUrl: string, name: string) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = name;
        link.click();
    }

    /** Saves an image into the user's history as though it had been generated. */
    async function storeToHistory(image: string) {
        const body: Record<string, unknown> = { ...buildGenInput(), image };
        // The history entry records how the image was made, not what it was made from; keeping the
        // editor's own init image and mask would embed a copy of the canvas in its metadata.
        delete body.initimage;
        delete body.maskimage;
        try {
            await api.post('AddImageToHistory', body);
            props.onNotice({ key: 'editor.notice.storedToHistory', tone: 'ok' });
        }
        catch {
            props.onNotice({ key: 'editor.notice.storeFailed', tone: 'error' });
        }
    }

    /** Runs SAM2's whole-image autosegment and drops the result in as a new layer. */
    function autoSegment() {
        if (!engine.host.supportedFeatures.includes('sam2')) {
            engine.host.onSam2Missing();
            return;
        }
        const body = buildGenInput();
        body.controlnetimageinput = engine.getFinalImageData();
        body.controlnetstrength = 1;
        body.controlnetpreprocessor = 'Segment Anything 2 Global Autosegment base_plus';
        body.controlnetpreviewonly = true;
        body.images = 1;
        body.prompt = '';
        body.donotsave = true;
        delete body.batchsize;
        engine.host.runGeneration(body, dataUrl => engine.addImageLayerFromUrl(dataUrl));
    }

    const items: { label: string; run: () => void; separated?: boolean }[] = [
        {
            label: t('editor.menu.downloadImage'),
            run: () => download(engine.getFinalImageData(), 'image.png')
        },
        {
            label: t('editor.menu.downloadCanvas'),
            run: () => download(engine.getMaximumImageData(), 'canvas.png')
        },
        { label: t('editor.menu.downloadMask'), run: () => download(engine.getFinalMaskData(), 'mask.png') },
        {
            label: t('editor.menu.copyFinal'),
            run: () => void engine.copySelectionToClipboard(false),
            separated: true
        },
        { label: t('editor.menu.copyLayer'), run: () => void engine.copySelectionToClipboard(true) },
        { label: t('editor.menu.paste'), run: () => void engine.pasteFromClipboard() },
        {
            label: t('editor.menu.storeImage'),
            run: () => void storeToHistory(engine.getFinalImageData()),
            separated: true
        },
        { label: t('editor.menu.storeCanvas'), run: () => void storeToHistory(engine.getMaximumImageData()) },
        { label: t('editor.menu.autoSegment'), run: autoSegment, separated: true }
    ];

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    title={t('editor.moreActions')}
                    aria-label={t('editor.moreActions')}
                    className="rounded p-2 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)] lg:p-1"
                >
                    <Ellipsis size={14} aria-hidden />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    className="z-50 min-w-56 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                >
                    {items.map(item => (
                        <Popover.Close asChild key={item.label}>
                            <button
                                type="button"
                                onClick={item.run}
                                className={[
                                    'block w-full rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-[var(--sw-hover)]',
                                    item.separated ? 'mt-1 border-t border-subtle pt-2' : ''
                                ].join(' ')}
                            >
                                {item.label}
                            </button>
                        </Popover.Close>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

function HeaderButton(props: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            title={props.label}
            aria-label={props.label}
            // Roomier below `lg`, where the press comes from a thumb rather than a cursor.
            className="rounded p-2 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)] disabled:opacity-40 disabled:hover:bg-transparent lg:p-1"
        >
            {props.children}
        </button>
    );
}
