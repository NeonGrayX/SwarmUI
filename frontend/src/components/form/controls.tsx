import { useId, useState } from 'react';
import { ArrowLeftRight, Dices, RotateCw, X } from 'lucide-react';
import type { ParamSchema } from '@/api/types';
import { swapResolution, useResolution } from '@/params/aspect';
import { useParamSchema } from '@/params/schema';
import { useParamStore, type ParamValue } from '@/params/store';
import { MediaField } from './MediaField';
import { LoraPicker } from './LoraPicker';
import { ModelPicker } from './ModelPicker';
import { PromptTextarea } from './PromptTextarea';
import { useTranslation } from '@/i18n';

export interface ControlProps {
    param: ParamSchema;
    value: ParamValue;
    onChange: (value: ParamValue) => void;
    disabled?: boolean;
    inputId: string;
}

/** Base input styling. Deliberately carries no width: Tailwind resolves conflicting width
 *  utilities by stylesheet order, not class-attribute order, so a `w-full` here would silently
 *  beat a per-control `w-16`. Each control states its own width. */
const INPUT_CLASS =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg ' +
    'outline-none focus:border-[var(--emphasis)] disabled:cursor-not-allowed';

/* ---------------------------------------------------------------------------------------------
 * Numeric
 * ------------------------------------------------------------------------------------------- */

/** Clamps a typed number into the param's range and onto its step grid. A `max` of 0 alongside a
 *  `min` of 0 is the server's "unbounded" (T2IParamType's defaults), not a range of one value. */
export function settleNumber(param: ParamSchema, raw: number): number {
    const step = param.step || 1;
    const bounded = param.min !== 0 || param.max !== 0;
    // Snapped relative to `min`, so a range like 64..16384 step 32 keeps to 64 + 32n, then fixed at
    // ten places to shed float noise (0.30000000000000004).
    const base = bounded ? param.min : 0;
    let value = Number((base + Math.round((raw - base) / step) * step).toFixed(10));
    if (param.type === 'integer') {
        value = Math.round(value);
    }
    if (bounded) {
        value = Math.max(value, param.min);
        if (param.max > param.min) {
            value = Math.min(value, param.max);
        }
    }
    return value;
}

/** A number box that keeps what is being typed as text, so clearing it to retype, or a lone '-' on
 *  the way to a negative, is not snapped back mid-edit. A complete in-range number goes through as
 *  it is typed, so a slider beside the box follows; the value is clamped and snapped to the step on
 *  blur or Enter, and an unfinished one falls back to what was there before. */
function NumberInput(props: ControlProps & { numeric: number; className: string }) {
    const { param } = props;
    const [draft, setDraft] = useState<string | null>(null);

    function commit(text: string): void {
        setDraft(null);
        const parsed = Number(text);
        if (text.trim() === '' || !Number.isFinite(parsed)) {
            return;
        }
        const settled = settleNumber(param, parsed);
        if (settled !== props.numeric) {
            props.onChange(settled);
        }
    }

    return (
        <input
            id={props.inputId}
            type="number"
            min={param.min}
            max={param.max}
            step={param.step || 1}
            value={draft ?? props.numeric}
            disabled={props.disabled}
            onChange={e => {
                const text = e.target.value;
                setDraft(text);
                const parsed = Number(text);
                if (text.trim() !== '' && Number.isFinite(parsed) && settleNumber(param, parsed) === parsed) {
                    props.onChange(parsed);
                }
            }}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    commit(e.currentTarget.value);
                }
            }}
            className={props.className}
        />
    );
}

/** Slider with an always-editable numeric box. The number is the source of truth and the track is
 *  a second view of it. `view_min`/`view_max` bound the track while `min`/`max` bound what can be
 *  typed (T2IParamTypes.cs ViewMin/ViewMax). */
export function SliderField(props: ControlProps) {
    const { t, tDynamic } = useTranslation();
    const { param } = props;
    const numeric = Number(props.value ?? param.min);
    const trackMin = param.view_min || param.min;
    const trackMax = param.view_max || param.max;

    return (
        <div className="flex flex-1 min-w-0 items-center gap-2">
            <input
                type="range"
                aria-label={t('control.slider', { label: tDynamic(param.name) })}
                min={trackMin}
                max={trackMax}
                step={param.step || 1}
                value={Math.min(Math.max(numeric, trackMin), trackMax)}
                disabled={props.disabled}
                onChange={e => props.onChange(Number(e.target.value))}
                className="flex-1 min-w-12 accent-[var(--emphasis)]"
            />
            <NumberInput
                {...props}
                numeric={numeric}
                className={`${INPUT_CLASS} w-16 shrink-0 px-1 text-right tabular-nums`}
            />
        </div>
    );
}

/** Power-of-two slider, used for width/height. The track moves in exponent space, so each notch
 *  doubles. */
export function PowerOfTwoSlider(props: ControlProps) {
    const { t, tDynamic } = useTranslation();
    const { param } = props;
    const numeric = Number(props.value ?? param.min);
    const toExp = (n: number) => Math.log2(Math.max(n, 1));
    const min = toExp(param.view_min || param.min || 1);
    const max = toExp(param.view_max || param.max || 1);

    return (
        <div className="flex items-center gap-2">
            <input
                type="range"
                aria-label={t('control.slider', { label: tDynamic(param.name) })}
                min={min}
                max={max}
                step={0.0001}
                value={Math.min(Math.max(toExp(numeric), min), max)}
                disabled={props.disabled}
                onChange={e => {
                    const raw = 2 ** Number(e.target.value);
                    const step = param.step || 1;
                    props.onChange(Math.round(raw / step) * step);
                }}
                className="flex-1 min-w-12 accent-[var(--emphasis)]"
            />
            <NumberInput
                {...props}
                numeric={numeric}
                className={`${INPUT_CLASS} w-16 shrink-0 px-1 text-right tabular-nums`}
            />
        </div>
    );
}

export function NumberField(props: ControlProps) {
    return (
        <NumberInput {...props} numeric={Number(props.value ?? props.param.min)} className={`${INPUT_CLASS} w-24`} />
    );
}

/** Seed input with randomize (-1) and reroll actions. */
export function SeedField(props: ControlProps) {
    const { t } = useTranslation();
    const numeric = Number(props.value ?? -1);
    return (
        <div className="flex items-center gap-1">
            <NumberInput {...props} numeric={numeric} className={`${INPUT_CLASS} flex-1 min-w-0`} />
            <IconButton
                label={t('control.seed.randomize')}
                active={numeric === -1}
                disabled={props.disabled}
                onClick={() => props.onChange(-1)}
            >
                <Dices size={14} aria-hidden />
            </IconButton>
            <IconButton
                label={t('control.seed.reroll')}
                disabled={props.disabled}
                onClick={() => props.onChange(Math.floor(Math.random() * 2 ** 31))}
            >
                <RotateCw size={14} aria-hidden />
            </IconButton>
        </div>
    );
}

/** The frame rate a frame count is measured against: the Video FPS param when it is switched on,
 *  otherwise 24, as getFPS does (params.js:126). */
function useVideoFps(): number {
    const on = useParamStore(s => s.toggles.videofps === true);
    const stored = useParamStore(s => s.values.videofps);
    const schema = useParamSchema();
    const param = schema?.byId.get('videofps');
    if (!param || (param.toggleable && !on)) {
        return 24;
    }
    const fps = Number(stored ?? param.default);
    return Number.isFinite(fps) && fps > 0 ? fps : 24;
}

/** Frame count, with the equivalent duration in seconds beside it. */
export function VideoFramesField(props: ControlProps) {
    const { t } = useTranslation();
    const numeric = Number(props.value ?? props.param.min);
    const fps = useVideoFps();
    const seconds = numeric > 0 ? (numeric / fps).toFixed(2) : '0';
    return (
        <div className="flex items-center gap-2">
            <SliderField {...props} />
            <span className="shrink-0 text-xs text-fg-soft tabular-nums">
                {t('control.videoFrames.seconds', { seconds })}
            </span>
        </div>
    );
}

/* ---------------------------------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------------------------------- */

export function TextField(props: ControlProps) {
    return (
        <input
            id={props.inputId}
            type="text"
            value={String(props.value ?? '')}
            disabled={props.disabled}
            placeholder={props.param.examples?.[0]}
            onChange={e => props.onChange(e.target.value)}
            className={`${INPUT_CLASS} w-full`}
        />
    );
}

/** Multi-line text. `prompt` view types get the prompt box hotkeys and suggestions, as they do in
 *  the legacy UI (getHtmlForParam, src/wwwroot/js/genpage/gentab/params.js:188); `big` ones don't. */
export function PromptField(props: ControlProps) {
    const shared = {
        id: props.inputId,
        rows: 3,
        disabled: props.disabled,
        placeholder: props.param.examples?.[0],
        className: `${INPUT_CLASS} w-full resize-y min-h-16`
    };
    const value = String(props.value ?? '');
    return props.param.view_type === 'prompt' ? (
        <PromptTextarea {...shared} value={value} onValueChange={props.onChange} />
    ) : (
        <textarea {...shared} value={value} onChange={e => props.onChange(e.target.value)} />
    );
}

/* ---------------------------------------------------------------------------------------------
 * Choice
 * ------------------------------------------------------------------------------------------- */

export function BooleanField(props: ControlProps) {
    const { t } = useTranslation();
    const on = props.value === true || props.value === 'true';
    return (
        <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
                id={props.inputId}
                type="checkbox"
                checked={on}
                disabled={props.disabled}
                onChange={e => props.onChange(e.target.checked)}
                className="accent-[var(--emphasis)]"
            />
            <span className="text-sm text-fg-soft">{on ? t('common.on') : t('common.off')}</span>
        </label>
    );
}

export function DropdownField(props: ControlProps) {
    const { tDynamic } = useTranslation();
    const { param } = props;
    const values = param.values ?? [];
    const names = param.value_names ?? [];
    const current = String(props.value ?? '');
    return (
        <select
            id={props.inputId}
            value={current}
            disabled={props.disabled}
            onChange={e => props.onChange(e.target.value)}
            className={`${INPUT_CLASS} w-full`}
        >
            {/* A value the list does not offer - from a preset, reused metadata, or a backend that
                has since lost an option - is shown as it is, rather than letting the browser show
                the first option while the stored value is something else. */}
            {!values.includes(current) && <option value={current}>{current}</option>}
            {values.map((option, i) => (
                <option key={option} value={option}>
                    {/* Option names are defined server-side, so they translate by source text.
                        The raw value is a wire identifier and is left as-is. */}
                    {names[i] ? tDynamic(names[i]) : option}
                </option>
            ))}
        </select>
    );
}

/** The aspect ratio dropdown, with what it resolves to beside it - width and height are hidden at
 *  a named ratio - and, at Custom, a button that swaps them. */
export function AspectRatioField(props: ControlProps) {
    const { t } = useTranslation();
    const schema = useParamSchema();
    const [width, height] = useResolution(schema);
    const custom = props.value === 'Custom';
    return (
        <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
                <DropdownField {...props} />
            </div>
            {custom ? (
                <IconButton
                    label={t('control.aspect.swap')}
                    disabled={props.disabled}
                    onClick={() => swapResolution(schema)}
                >
                    <ArrowLeftRight size={14} aria-hidden />
                </IconButton>
            ) : (
                <span className="shrink-0 text-xs text-fg-soft tabular-nums">
                    {width}×{height}
                </span>
            )}
        </div>
    );
}

/** Model picker. The option list is keyed off the param's `subtype` (eg 'Stable-Diffusion',
 *  'LoRA', 'VAE'); ModelPicker resolves it from the schema itself, so nothing has to be threaded
 *  down to reach it. */
export function ModelField(props: ControlProps) {
    const schema = useParamSchema();
    const subtype = props.param.subtype ?? 'Stable-Diffusion';
    // A param that carries its own list can lead it with choices that are not files - VAE offers
    // "Automatic" and "None" (listVaes, T2IParamTypes.cs:554) - and those have to be pickable too.
    const installed = schema?.models[subtype];
    const sentinels = installed ? (props.param.values ?? []).filter(value => !installed.includes(value)) : [];
    return (
        <ModelPicker
            id={props.inputId}
            subtype={subtype}
            value={String(props.value ?? '')}
            emptyValue={props.param.default ?? ''}
            sentinels={sentinels}
            disabled={props.disabled}
            onChange={props.onChange}
        />
    );
}

/** Pick-several control, for list params that come with their own set of choices - what the
 *  existing interface renders as a multiselect (getHtmlForParam, params.js:220). */
export function MultiSelectField(props: ControlProps) {
    const { t, tDynamic } = useTranslation();
    const { param } = props;
    const options = param.values ?? [];
    const names = param.value_names ?? [];
    const list = Array.isArray(props.value) ? props.value : [];
    const label = (value: string) => {
        const index = options.indexOf(value);
        return index >= 0 && names[index] ? tDynamic(names[index]) : value;
    };
    const remaining = options.filter(option => !list.includes(option));
    return (
        <div className="min-w-0">
            {list.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                    {list.map(value => (
                        <span
                            key={value}
                            className="inline-flex max-w-full items-center gap-0.5 rounded border border-subtle bg-surface px-1.5 py-0.5 text-xs text-fg"
                        >
                            <span className="truncate">{label(value)}</span>
                            <button
                                type="button"
                                disabled={props.disabled}
                                onClick={() => props.onChange(list.filter(entry => entry !== value))}
                                aria-label={t('control.multiselect.remove', { value: label(value) })}
                                className="shrink-0 rounded text-fg-soft hover:text-fg"
                            >
                                <X size={11} aria-hidden />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <select
                id={props.inputId}
                value=""
                disabled={props.disabled || remaining.length === 0}
                onChange={e => {
                    if (e.target.value) {
                        props.onChange([...list, e.target.value]);
                    }
                }}
                className={`${INPUT_CLASS} w-full`}
            >
                <option value="">{t('control.multiselect.add')}</option>
                {remaining.map(option => (
                    <option key={option} value={option}>
                        {label(option)}
                    </option>
                ))}
            </select>
        </div>
    );
}

/** Comma-separated multi-value input, for list params that are not model lists. */
export function ListField(props: ControlProps) {
    const list = Array.isArray(props.value) ? props.value : [];
    return (
        <input
            id={props.inputId}
            type="text"
            value={list.join(', ')}
            disabled={props.disabled}
            placeholder={props.param.values?.slice(0, 3).join(', ')}
            onChange={e =>
                props.onChange(
                    e.target.value
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                )
            }
            className={`${INPUT_CLASS} w-full`}
        />
    );
}

function IconButton(props: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={props.label}
            aria-label={props.label}
            aria-pressed={props.active}
            disabled={props.disabled}
            onClick={props.onClick}
            className={[
                'shrink-0 rounded border border-default p-1.5 transition-colors',
                props.active ? 'text-fg-strong bg-[var(--sw-active)]' : 'text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]'
            ].join(' ')}
        >
            {props.children}
        </button>
    );
}

/* ---------------------------------------------------------------------------------------------
 * Dispatch
 * ------------------------------------------------------------------------------------------- */

/** Id of the base model picker in the parameter form, so the composer's "no model selected" notice
 *  can jump to it. Fixed rather than generated because it is the one control something outside the
 *  form has to be able to find. */
export const MODEL_SELECT_ID = 'param-model-select';

/** Picks the control for a param. `view_type` wins where it is meaningful, otherwise the data type
 *  decides. Mirrors the switch in getHtmlForParam (src/wwwroot/js/genpage/gentab/params.js:182). */
export function ParamControl(props: Omit<ControlProps, 'inputId'>) {
    const generatedId = useId();
    const inputId = props.param.id === 'model' ? MODEL_SELECT_ID : `param-${props.param.id}-${generatedId}`;
    const inner = { ...props, inputId };
    const { param } = props;

    switch (param.type) {
        case 'boolean':
            return <BooleanField {...inner} />;
        case 'dropdown':
            return param.id === 'aspectratio' ? <AspectRatioField {...inner} /> : <DropdownField {...inner} />;
        case 'model':
            return <ModelField {...inner} />;
        case 'list':
            // `loras` is a list of models edited alongside its weights, so it gets its own control;
            // a list with its own choices picks from them, and anything else stays a plain
            // comma-separated box.
            if (param.id === 'loras') {
                return <LoraPicker inputId={inputId} disabled={props.disabled} />;
            }
            return param.values?.length ? <MultiSelectField {...inner} /> : <ListField {...inner} />;
        case 'image':
        case 'image_list':
        case 'audio':
        case 'audio_list':
        case 'video':
        case 'video_list':
            return <MediaField {...inner} />;
        case 'integer':
        case 'decimal':
            switch (param.view_type) {
                case 'slider':
                    return <SliderField {...inner} />;
                // 'big' is a wide number box in the existing interface (params.js:200), not a slider.
                case 'big':
                    return <NumberField {...inner} />;
                case 'pot_slider':
                    return <PowerOfTwoSlider {...inner} />;
                case 'seed':
                    return <SeedField {...inner} />;
                case 'video_frames':
                    return <VideoFramesField {...inner} />;
                default:
                    return <NumberField {...inner} />;
            }
        default:
            return param.view_type === 'prompt' || param.view_type === 'big' ? (
                <PromptField {...inner} />
            ) : (
                <TextField {...inner} />
            );
    }
}
