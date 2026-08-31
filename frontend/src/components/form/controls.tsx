import { useId } from 'react';
import { Dices, RotateCw } from 'lucide-react';
import type { ParamSchema } from '@/api/types';
import type { ParamValue } from '@/params/store';
import { MediaField } from './MediaField';
import { LoraPicker } from './LoraPicker';
import { ModelPicker } from './ModelPicker';
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

/** Slider with an always-editable numeric box. The number is the source of truth and the track is
 *  a second view of it. `view_min`/`view_max` bound the track while `min`/`max` bound what can be
 *  typed (T2IParamTypes.cs ViewMin/ViewMax). */
export function SliderField(props: ControlProps & { big?: boolean }) {
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
            <input
                id={props.inputId}
                type="number"
                min={param.min}
                max={param.max}
                step={param.step || 1}
                value={numeric}
                disabled={props.disabled}
                onChange={e => props.onChange(e.target.value === '' ? param.min : Number(e.target.value))}
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
            <input
                id={props.inputId}
                type="number"
                min={param.min}
                max={param.max}
                step={param.step || 1}
                value={numeric}
                disabled={props.disabled}
                onChange={e => props.onChange(e.target.value === '' ? param.min : Number(e.target.value))}
                className={`${INPUT_CLASS} w-16 shrink-0 px-1 text-right tabular-nums`}
            />
        </div>
    );
}

export function NumberField(props: ControlProps) {
    const { param } = props;
    return (
        <input
            id={props.inputId}
            type="number"
            min={param.min}
            max={param.max}
            step={param.step || 1}
            value={Number(props.value ?? param.min)}
            disabled={props.disabled}
            onChange={e => props.onChange(e.target.value === '' ? param.min : Number(e.target.value))}
            className={`${INPUT_CLASS} w-24`}
        />
    );
}

/** Seed input with randomize (-1) and reroll actions. */
export function SeedField(props: ControlProps) {
    const { t } = useTranslation();
    const numeric = Number(props.value ?? -1);
    return (
        <div className="flex items-center gap-1">
            <input
                id={props.inputId}
                type="number"
                min={props.param.min}
                max={props.param.max}
                step={1}
                value={numeric}
                disabled={props.disabled}
                onChange={e => props.onChange(e.target.value === '' ? -1 : Number(e.target.value))}
                className={`${INPUT_CLASS} flex-1 min-w-0`}
            />
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

/** Frame count, with the equivalent duration in seconds beside it. */
export function VideoFramesField(props: ControlProps) {
    const { t } = useTranslation();
    const numeric = Number(props.value ?? props.param.min);
    const seconds = numeric > 0 ? (numeric / 24).toFixed(2) : '0';
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

export function PromptField(props: ControlProps) {
    return (
        <textarea
            id={props.inputId}
            rows={3}
            value={String(props.value ?? '')}
            disabled={props.disabled}
            placeholder={props.param.examples?.[0]}
            onChange={e => props.onChange(e.target.value)}
            className={`${INPUT_CLASS} w-full resize-y min-h-16`}
        />
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
    return (
        <select
            id={props.inputId}
            value={String(props.value ?? '')}
            disabled={props.disabled}
            onChange={e => props.onChange(e.target.value)}
            className={`${INPUT_CLASS} w-full`}
        >
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

/** Model picker. The option list is keyed off the param's `subtype` (eg 'Stable-Diffusion',
 *  'LoRA', 'VAE'); ModelPicker resolves it from the schema itself, so nothing has to be threaded
 *  down to reach it. */
export function ModelField(props: ControlProps) {
    return (
        <ModelPicker
            id={props.inputId}
            subtype={props.param.subtype ?? 'Stable-Diffusion'}
            value={String(props.value ?? '')}
            emptyValue={props.param.default ?? ''}
            disabled={props.disabled}
            onChange={props.onChange}
        />
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

/** Picks the control for a param. `view_type` wins where it is meaningful, otherwise the data type
 *  decides. Mirrors the switch in getHtmlForParam (src/wwwroot/js/genpage/gentab/params.js:182). */
export function ParamControl(props: Omit<ControlProps, 'inputId'>) {
    const generatedId = useId();
    const inputId = `param-${props.param.id}-${generatedId}`;
    const inner = { ...props, inputId };
    const { param } = props;

    switch (param.type) {
        case 'boolean':
            return <BooleanField {...inner} />;
        case 'dropdown':
            return <DropdownField {...inner} />;
        case 'model':
            return <ModelField {...inner} />;
        case 'list':
            // `loras` is a list of models edited alongside its weights, so it gets its own control;
            // anything else stays a plain comma-separated box.
            return param.id === 'loras' ? (
                <LoraPicker inputId={inputId} disabled={props.disabled} />
            ) : (
                <ListField {...inner} />
            );
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
                case 'big':
                    return <SliderField {...inner} big />;
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
