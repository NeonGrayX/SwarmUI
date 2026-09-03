import { useCallback, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Layers as LayersIcon, SquarePlus } from 'lucide-react';
import type { EditorLayer } from '@/editor/layer';
import { useEditorEngine, useEditorVersion } from '@/editor/store';
import { useContextMenu, type MenuAction } from '../ui/ContextMenu';
import { useTranslation } from '@/i18n';

/** The layer list, topmost layer first.
 *
 * `engine.layers` is in draw order, so both layouts render it reversed: the layer drawn last is
 * the one on top, and that is what a layer panel puts first.
 *
 * Two layouts rather than one responsive one, because each layer's thumbnail *is* that layer's own
 * canvas element, moved into the row rather than copied - which is what makes the preview update
 * live as a stroke is painted, and also means one element cannot be in two lists at once. Wide
 * screens get the column down the right edge; anything narrower gets a strip along the bottom,
 * where a horizontal row of thumbnails costs a fixed height instead of a quarter of the width the
 * canvas needs. The caller picks, since it also has to flip the flex direction around this. */
export function LayerPanel(props: { orientation: 'column' | 'strip' }) {
    return props.orientation === 'strip' ? <LayerStrip /> : <LayerColumn />;
}

/** Everything the two layouts share: the ordered list, the per-layer menu, drag reordering. */
function useLayerList() {
    const { t } = useTranslation();
    const engine = useEditorEngine();
    useEditorVersion();
    const menu = useContextMenu();
    const [dragging, setDragging] = useState<EditorLayer | null>(null);

    const ordered = [...engine.layers].reverse();

    /** Menu for one layer. Reordering lives here as well as on the drag handle: HTML drag and drop
     *  never fires for a finger, so without these two rows a touch screen could not restack at
     *  all. Masks always sort above images, so a move that would cross that line is left out
     *  rather than offered and then undone by the sort. */
    function actionsFor(layer: EditorLayer): MenuAction[] {
        const kin = engine.layers.filter(other => other.isMask === layer.isMask);
        const at = kin.indexOf(layer);
        const index = engine.layers.indexOf(layer);
        const actions: MenuAction[] = [];
        if (at < kin.length - 1) {
            actions.push({
                label: t('editor.layer.bringForward'),
                onSelect: () => engine.moveLayer(layer, index + 2)
            });
        }
        if (at > 0) {
            actions.push({
                label: t('editor.layer.sendBackward'),
                onSelect: () => engine.moveLayer(layer, index - 1)
            });
        }
        return [
            ...actions,
            {
                label: layer.isMask ? t('editor.layer.convertToImage') : t('editor.layer.convertToMask'),
                onSelect: () => engine.setLayerIsMask(layer, !layer.isMask),
                separated: actions.length > 0
            },
            {
                label: layer.isMask ? t('editor.layer.invertMask') : t('editor.layer.invertColors'),
                onSelect: () => layer.invert()
            },
            {
                label: t('editor.layer.delete'),
                onSelect: () => engine.removeLayer(layer),
                destructive: true,
                separated: true
            }
        ];
    }

    /** Drops the dragged layer before or after `target`, depending on which half was released on. */
    function onDrop(e: React.DragEvent, target: EditorLayer, axis: 'x' | 'y') {
        e.preventDefault();
        if (!dragging || dragging === target) {
            return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const past =
            axis === 'y' ? e.clientY - rect.top > rect.height / 2 : e.clientX - rect.left > rect.width / 2;
        const displayIndex = ordered.indexOf(target) + (past ? 1 : 0);
        engine.moveLayer(dragging, engine.layers.length - displayIndex);
        setDragging(null);
    }

    /** Props every layer tile carries, whichever way the list runs. */
    function tileProps(layer: EditorLayer, axis: 'x' | 'y') {
        return {
            draggable: true,
            onDragStart: () => setDragging(layer),
            onDragEnd: () => setDragging(null),
            onDragOver: (e: React.DragEvent) => e.preventDefault(),
            onDrop: (e: React.DragEvent) => onDrop(e, layer, axis),
            onContextMenu: (e: React.MouseEvent) => menu.open(e, actionsFor(layer)),
            ...menu.touch(() => actionsFor(layer))
        };
    }

    return { t, engine, menu, ordered, tileProps };
}

/** The two add buttons, which sit in the header of either layout. */
function AddButtons() {
    const { t } = useTranslation();
    const engine = useEditorEngine();
    return (
        <>
            <IconButton label={t('editor.layer.addImage')} onClick={() => engine.addEmptyLayer()}>
                <ImagePlus size={13} aria-hidden />
            </IconButton>
            <IconButton label={t('editor.layer.addMask')} onClick={() => engine.addEmptyMaskLayer()}>
                <SquarePlus size={13} aria-hidden />
            </IconButton>
        </>
    );
}

/** Opacity for the layer in hand. */
function OpacitySlider(props: { layer: EditorLayer; className?: string }) {
    const { t } = useTranslation();
    const engine = useEditorEngine();
    return (
        <label className={`flex items-center gap-1.5 text-[10px] text-fg-soft ${props.className ?? ''}`}>
            {t('editor.layer.opacity')}
            <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(props.layer.opacity * 100)}
                onChange={e => engine.setLayerOpacity(props.layer, Number(e.target.value) / 100)}
                className="min-w-0 flex-1 accent-[var(--emphasis)]"
            />
        </label>
    );
}

function LayerName(props: { layer: EditorLayer }) {
    const { t } = useTranslation();
    const { layer } = props;
    return (
        <>
            <span className="block truncate">
                {layer.isMask ? t('editor.layer.mask') : t('editor.layer.image')}
            </span>
            <span className="block text-[10px] text-fg-soft tabular-nums">
                {Math.round(layer.width)}×{Math.round(layer.height)}
            </span>
        </>
    );
}

/** Border and fill for a tile, which is the only thing marking the layer in hand. */
function tileStyle(active: boolean) {
    return {
        borderColor: active ? 'var(--emphasis)' : 'var(--light-border)',
        background: active ? 'var(--sw-active)' : 'var(--sw-surface-sunken)'
    };
}

/** The list as a column down the right edge - the desktop layout. */
function LayerColumn() {
    const { t, engine, menu, ordered, tileProps } = useLayerList();

    return (
        <div className="flex h-full w-44 shrink-0 flex-col border-l border-subtle bg-surface">
            <div className="flex shrink-0 items-center gap-1 border-b border-subtle px-2 py-1.5">
                <LayersIcon size={13} className="text-fg-soft" aria-hidden />
                <h2 className="flex-1 text-xs font-medium text-fg-strong">{t('editor.layers')}</h2>
                <AddButtons />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
                {ordered.map(layer => {
                    const active = layer === engine.activeLayer;
                    return (
                        <div key={layer.id} {...tileProps(layer, 'y')} className="rounded border" style={tileStyle(active)}>
                            <button
                                type="button"
                                onClick={() => engine.setActiveLayer(layer)}
                                aria-current={active ? 'true' : undefined}
                                className="flex w-full items-center gap-2 p-1.5 text-left"
                            >
                                <LayerThumbnail layer={layer} className="h-9 w-9" />
                                <span className="min-w-0 flex-1 text-xs text-fg">
                                    <LayerName layer={layer} />
                                </span>
                            </button>

                            {/* Only the layer in hand shows its opacity, so the list stays a list. */}
                            {active && <OpacitySlider layer={layer} className="px-1.5 pb-1.5" />}
                        </div>
                    );
                })}
                {ordered.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-fg-soft">{t('editor.layer.none')}</p>
                )}
            </div>
            {menu.menu}
        </div>
    );
}

/** How much viewport a phone needs before the tiles can be shown without starving the canvas.
 *
 * A portrait phone gives the editor around 240px between the workspace tabs above and the prompt
 * composer below. The option bar claims up to half of that, so a strip of thumbnails on top would
 * leave the canvas with nothing at all - hence the fold, which the header keeps one tap away. */
const ROOM_FOR_TILES = 900;

/** The same list as a strip along the bottom - the layout for narrow screens.
 *
 * Reading order is preserved: leftmost is topmost. The opacity slider moves up into the header
 * rather than expanding the tile in hand, which would make the row jump every time the selection
 * changed, and the whole strip folds away for when the canvas needs the height more. */
function LayerStrip() {
    const { t, engine, menu, ordered, tileProps } = useLayerList();
    const [open, setOpen] = useState(() => window.innerHeight >= ROOM_FOR_TILES);
    const active = engine.activeLayer;

    return (
        <div className="flex shrink-0 flex-col border-t border-subtle bg-surface">
            <div className="flex shrink-0 items-center gap-1 px-2 py-1">
                <LayersIcon size={13} className="text-fg-soft" aria-hidden />
                <h2 className="text-xs font-medium text-fg-strong">{t('editor.layers')}</h2>
                {active && <OpacitySlider layer={active} className="ml-2 min-w-0 max-w-44 flex-1" />}
                <div className="flex-1" />
                <AddButtons />
                <IconButton
                    label={open ? t('editor.layers.collapse') : t('editor.layers.expand')}
                    expanded={open}
                    onClick={() => setOpen(value => !value)}
                >
                    {open ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
                </IconButton>
            </div>

            {open && (
                <div className="flex shrink-0 gap-1.5 overflow-x-auto px-2 pb-2">
                    {ordered.map(layer => {
                        const selected = layer === engine.activeLayer;
                        return (
                            <div
                                key={layer.id}
                                {...tileProps(layer, 'x')}
                                className="shrink-0 rounded border"
                                style={tileStyle(selected)}
                            >
                                <button
                                    type="button"
                                    onClick={() => engine.setActiveLayer(layer)}
                                    aria-current={selected ? 'true' : undefined}
                                    className="flex w-20 flex-col items-center gap-1 p-1 text-center"
                                >
                                    <LayerThumbnail layer={layer} className="h-10 w-10" />
                                    <span className="w-full min-w-0 text-[11px] text-fg">
                                        <LayerName layer={layer} />
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                    {ordered.length === 0 && (
                        <p className="w-full py-4 text-center text-xs text-fg-soft">{t('editor.layer.none')}</p>
                    )}
                </div>
            )}
            {menu.menu}
        </div>
    );
}

/** Hosts the layer's live canvas. */
function LayerThumbnail(props: { layer: EditorLayer; className: string }) {
    const { layer } = props;
    const mount = useCallback(
        (node: HTMLSpanElement | null) => {
            if (node) {
                layer.canvas.style.maxWidth = '100%';
                layer.canvas.style.maxHeight = '100%';
                layer.canvas.style.objectFit = 'contain';
                node.appendChild(layer.canvas);
            }
        },
        [layer]
    );
    return (
        <span
            ref={mount}
            aria-hidden
            className={`flex shrink-0 items-center justify-center overflow-hidden rounded border border-subtle ${props.className}`}
            style={{
                opacity: layer.opacity,
                // A checkerboard, so a transparent layer reads as empty rather than as black.
                backgroundImage:
                    'linear-gradient(45deg, var(--sw-surface) 25%, transparent 25%, transparent 75%, var(--sw-surface) 75%),' +
                    'linear-gradient(45deg, var(--sw-surface) 25%, transparent 25%, transparent 75%, var(--sw-surface) 75%)',
                backgroundSize: '8px 8px',
                backgroundPosition: '0 0, 4px 4px',
                backgroundColor: 'var(--sw-surface-sunken)'
            }}
        />
    );
}

function IconButton(props: {
    label: string;
    onClick: () => void;
    /** Set only on a button that folds something away, which is the one thing here with a state. */
    expanded?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            title={props.label}
            aria-label={props.label}
            aria-expanded={props.expanded}
            className="rounded p-1.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
        >
            {props.children}
        </button>
    );
}
