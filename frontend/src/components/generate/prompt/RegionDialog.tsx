import { useRef, useState } from 'react';
import { PromptTextarea } from '@/components/form/PromptTextarea';
import { useTranslation } from '@/i18n';
import { useParamSchema } from '@/params/schema';
import { useParamStore, valueOf } from '@/params/store';
import { SYNTAX_INPUT_CLASS, SyntaxDialog, SyntaxField, UnitSlider, round2 } from './SyntaxDialogParts';

const DOCS_URL = 'https://github.com/mcmonkeyprojects/SwarmUI/blob/master/docs/Features/Prompt%20Syntax.md#regional-prompting';

/** Remembers the last region type picked, as the legacy modal does under `text_prompt_region_type`. */
const TYPE_KEY = 'swarm-ui-prompt-region-type';

type RegionType = 'region' | 'ideogram';

interface RegionForm {
    x: number;
    y: number;
    width: number;
    height: number;
    strength: number;
    inpaint: boolean;
    inpaintStrength: number;
    genText: string;
}

const FRESH: RegionForm = { x: 0.25, y: 0.25, width: 0.5, height: 0.5, strength: 0.5, inpaint: false, inpaintStrength: 0.5, genText: '' };

function storedType(): RegionType {
    return localStorage.getItem(TYPE_KEY) === 'ideogram' ? 'ideogram' : 'region';
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** The syntax a form describes. Ported from regionModalSubmit (prompttools.js:835): the box is
 *  clamped into the image, then written as a `<region:...>` (or, with inpainting, `<object:...>`)
 *  tag, or as an Ideogram JSON element with a 0-1000 `[y1, x1, y2, x2]` bbox. */
function regionSyntax(type: RegionType, form: RegionForm): string {
    const x = clamp01(form.x);
    const y = clamp01(form.y);
    const w = clamp01(form.width + x) - x;
    const h = clamp01(form.height + y) - y;
    const text = form.genText.trim();
    if (type === 'ideogram') {
        const bbox = [Math.round(y * 1000), Math.round(x * 1000), Math.round((y + h) * 1000), Math.round((x + w) * 1000)];
        return `{"type": "obj", "bbox": [${bbox.join(', ')}], "desc": ${JSON.stringify(text)}}`;
    }
    const key = form.inpaint ? 'object' : 'region';
    const inpaint = form.inpaint ? `,${form.inpaintStrength}` : '';
    return `<${key}:${round2(x)},${round2(y)},${round2(w)},${round2(h)},${form.strength}${inpaint}> ${text}`;
}

/** "Regional Prompt": builds a `<region:...>` / `<object:...>` tag (or an Ideogram JSON element)
 *  for a box drawn on a preview of the image. Ported from the legacy text_prompt_region_modal
 *  (src/Pages/_Generate/GenTabModals.cshtml:26, prompttools.js:669). */
export function RegionDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (syntax: string) => void }) {
    const { t } = useTranslation();
    const [type, setType] = useState<RegionType>(storedType);
    const [form, setForm] = useState<RegionForm>(FRESH);
    const [wasOpen, setWasOpen] = useState(props.open);
    if (props.open !== wasOpen) {
        setWasOpen(props.open);
        if (props.open) {
            setForm(FRESH);
        }
    }
    const update = (patch: Partial<RegionForm>) => setForm(current => ({ ...current, ...patch }));
    const classic = type === 'region';

    return (
        <SyntaxDialog
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t('promptTools.region.title')}
            intro={t('promptTools.region.intro')}
            docsUrl={DOCS_URL}
            docsLabel={t('promptTools.region.docs')}
            canAdd
            onAdd={() => props.onAdd(regionSyntax(type, form))}
        >
            <SyntaxField label={t('promptTools.region.type')} help={t('promptTools.region.type')}>
                {id => (
                    <select
                        id={id}
                        value={type}
                        onChange={e => {
                            const next = e.target.value === 'ideogram' ? 'ideogram' : 'region';
                            setType(next);
                            localStorage.setItem(TYPE_KEY, next);
                        }}
                        className={`${SYNTAX_INPUT_CLASS} min-w-0 flex-1`}
                    >
                        <option value="region">{t('promptTools.region.typeClassic')}</option>
                        <option value="ideogram">{t('promptTools.region.typeIdeogram')}</option>
                    </select>
                )}
            </SyntaxField>
            {props.open && <RegionCanvas form={form} onChange={update} />}
            {classic && (
                <>
                    <SyntaxField label={t('promptTools.region.x')} help={t('promptTools.region.xHelp')}>
                        {id => <UnitSlider id={id} label={t('promptTools.region.x')} value={form.x} step={0.01} onChange={x => update({ x })} />}
                    </SyntaxField>
                    <SyntaxField label={t('promptTools.region.y')} help={t('promptTools.region.yHelp')}>
                        {id => <UnitSlider id={id} label={t('promptTools.region.y')} value={form.y} step={0.01} onChange={y => update({ y })} />}
                    </SyntaxField>
                    <SyntaxField label={t('promptTools.region.width')} help={t('promptTools.region.widthHelp')}>
                        {id => <UnitSlider id={id} label={t('promptTools.region.width')} value={form.width} step={0.01} onChange={width => update({ width })} />}
                    </SyntaxField>
                    <SyntaxField label={t('promptTools.region.height')} help={t('promptTools.region.heightHelp')}>
                        {id => <UnitSlider id={id} label={t('promptTools.region.height')} value={form.height} step={0.01} onChange={height => update({ height })} />}
                    </SyntaxField>
                    <SyntaxField label={t('promptTools.region.strength')} help={t('promptTools.region.strengthHelp')}>
                        {id => <UnitSlider id={id} label={t('promptTools.region.strength')} value={form.strength} step={0.01} onChange={strength => update({ strength })} />}
                    </SyntaxField>
                    <SyntaxField label={t('promptTools.region.inpaint')} help={t('promptTools.region.inpaintHelp')}>
                        {id => <input id={id} type="checkbox" checked={form.inpaint} onChange={e => update({ inpaint: e.target.checked })} className="accent-[var(--emphasis)]" />}
                    </SyntaxField>
                    {form.inpaint && (
                        <SyntaxField label={t('promptTools.region.inpaintStrength')} help={t('promptTools.region.inpaintStrengthHelp')}>
                            {id => (
                                <UnitSlider
                                    id={id}
                                    label={t('promptTools.region.inpaintStrength')}
                                    value={form.inpaintStrength}
                                    step={0.01}
                                    onChange={inpaintStrength => update({ inpaintStrength })}
                                />
                            )}
                        </SyntaxField>
                    )}
                </>
            )}
            <SyntaxField label={t('promptTools.genPrompt')} help={t('promptTools.genPromptHelp')}>
                {id => (
                    <PromptTextarea
                        id={id}
                        rows={2}
                        value={form.genText}
                        placeholder={t('promptTools.genPromptPlaceholder')}
                        onValueChange={genText => update({ genText })}
                        className={`${SYNTAX_INPUT_CLASS} w-full resize-y`}
                    />
                )}
            </SyntaxField>
        </SyntaxDialog>
    );
}

/** Which part of the box a drag holds: a corner (top-left, top-right, bottom-left, bottom-right)
 *  or the centre, which moves the whole box. Same numbering as RegionModalCircle ids. */
type Handle = 0 | 1 | 2 | 3 | 4;

/** Preview the size of the image's aspect, halved until under 512px, as regionModalClear sizes its
 *  canvas. */
function usePreviewSize(): { width: number; height: number } {
    const schema = useParamSchema();
    const widthParam = schema?.byId.get('width');
    const heightParam = schema?.byId.get('height');
    const rawWidth = useParamStore(s => (widthParam ? Number(valueOf(widthParam, s.values)) : 1024));
    const rawHeight = useParamStore(s => (heightParam ? Number(valueOf(heightParam, s.values)) : 1024));
    let width = rawWidth > 0 ? rawWidth : 1024;
    let height = rawHeight > 0 ? rawHeight : 1024;
    while (width >= 512 || height >= 512) {
        width /= 2;
        height /= 2;
    }
    return { width, height };
}

/** The box drawn over the image, with a handle at each corner and one in the middle. Dragging a
 *  handle edits the form's X/Y/Width/Height. Ported from regionModalMouseMove (prompttools.js:735). */
function RegionCanvas(props: { form: RegionForm; onChange: (patch: Partial<RegionForm>) => void }) {
    const { t } = useTranslation();
    const size = usePreviewSize();
    const area = useRef<HTMLDivElement>(null);
    const [held, setHeld] = useState<Handle | null>(null);
    const { x, y, width: w, height: h } = props.form;

    const move = (e: React.PointerEvent) => {
        const rect = area.current?.getBoundingClientRect();
        if (held === null || !rect) {
            return;
        }
        let realX = clamp01(round2((e.clientX - rect.left) / rect.width));
        let realY = clamp01(round2((e.clientY - rect.top) / rect.height));
        if (Math.abs(realX - x) < 0.01) {
            realX = x;
        }
        if (Math.abs(realY - y) < 0.01) {
            realY = y;
        }
        let x1 = x;
        let y1 = y;
        let x2 = x + w;
        let y2 = y + h;
        if (held === 0) {
            x1 = realX;
            y1 = realY;
        }
        else if (held === 1) {
            x2 = realX;
            y1 = realY;
        }
        else if (held === 2) {
            x1 = realX;
            y2 = realY;
        }
        else if (held === 3) {
            x2 = realX;
            y2 = realY;
        }
        else {
            x1 = realX - w / 2;
            x2 = realX + w / 2;
            y1 = realY - h / 2;
            y2 = realY + h / 2;
        }
        const patch: Partial<RegionForm> = {};
        if (x1 < x2) {
            patch.x = round2(x1);
            patch.width = round2(x2 - x1);
        }
        if (y1 < y2) {
            patch.y = round2(y1);
            patch.height = round2(y2 - y1);
        }
        props.onChange(patch);
    };

    const handles: [Handle, number, number][] = [
        [0, x, y],
        [1, x + w, y],
        [2, x, y + h],
        [3, x + w, y + h],
        [4, x + w / 2, y + h / 2]
    ];

    return (
        <div
            ref={area}
            role="group"
            aria-label={t('promptTools.region.preview')}
            onPointerMove={move}
            onPointerUp={() => setHeld(null)}
            onPointerCancel={() => setHeld(null)}
            className="relative mx-auto touch-none select-none border-2 border-default bg-surface-sunken"
            style={{ width: size.width, height: size.height }}
        >
            <div
                className="pointer-events-none absolute border"
                style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${h * 100}%`,
                    borderColor: 'rgb(200, 0, 0)',
                    background: 'color-mix(in srgb, rgb(150, 120, 120) 70%, transparent)'
                }}
            />
            {handles.map(([id, hx, hy]) => (
                <div
                    key={id}
                    onPointerDown={e => {
                        e.preventDefault();
                        area.current?.setPointerCapture(e.pointerId);
                        setHeld(id);
                    }}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border"
                    style={{
                        left: `${hx * 100}%`,
                        top: `${hy * 100}%`,
                        borderColor: 'rgb(0, 200, 0)',
                        background: held === id ? 'rgb(0, 180, 0)' : 'rgb(0, 50, 0)'
                    }}
                />
            ))}
        </div>
    );
}
