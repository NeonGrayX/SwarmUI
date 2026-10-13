import { useMemo, useState } from 'react';
import { PromptTextarea } from '@/components/form/PromptTextarea';
import { useTranslation } from '@/i18n';
import { useParamSchema } from '@/params/schema';
import { SYNTAX_INPUT_CLASS, SyntaxDialog, SyntaxField, ToggledSelect, UnitSlider } from './SyntaxDialogParts';

const CLIP_SEG = 'CLIP-Seg';

const DOCS_URL = 'https://github.com/mcmonkeyprojects/SwarmUI/blob/master/docs/Features/Prompt%20Syntax.md#automatic-segmentation-and-refining';

/** The dialog's fields, fresh each time it opens (segmentModalClear, prompttools.js:574). */
interface SegmentForm {
    model: string;
    textMatch: string;
    yoloId: number;
    classIds: string;
    creativity: number;
    threshold: number;
    invert: boolean;
    genText: string;
    useSampler: boolean;
    sampler: string;
    useScheduler: boolean;
    scheduler: string;
}

/** A dropdown param's options, for the optional sampler/scheduler override. */
function useParamOptions(paramId: string): { value: string; name: string }[] {
    const schema = useParamSchema();
    const { tDynamic } = useTranslation();
    return useMemo(() => {
        const param = schema?.byId.get(paramId);
        const names = param?.value_names ?? [];
        return (param?.values ?? []).map((value, i) => ({ value, name: names[i] ? tDynamic(names[i]) : value }));
    }, [schema, paramId, tDynamic]);
}

/** The `<segment:...>` syntax a form describes. Ported from segmentModalSubmit (prompttools.js:625). */
function segmentSyntax(form: SegmentForm): string {
    let modelText = form.model;
    if (modelText === CLIP_SEG) {
        modelText = form.textMatch.trim();
    }
    else {
        if (form.yoloId > 0) {
            modelText += `-${form.yoloId}`;
        }
        const classIds = form.classIds.trim();
        if (classIds) {
            modelText += `:${classIds}:`;
        }
    }
    let append = '';
    if (form.useSampler) {
        append += `<param[sampler]:${form.sampler}>`;
    }
    if (form.useScheduler) {
        append += `<param[scheduler]:${form.scheduler}>`;
    }
    return `<segment:${modelText},${form.creativity},${form.invert ? '-' : ''}${form.threshold}>${append} ${form.genText.trim()}`;
}

/** "Auto Segment Refinement": builds a `<segment:...>` tag that masks part of the finished image,
 *  by CLIP-Seg text match or a YOLOv8 model, and inpaints it again. Ported from the legacy
 *  text_prompt_segment_modal (src/Pages/_Generate/GenTabModals.cshtml:5, prompttools.js:428). */
export function SegmentDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (syntax: string) => void }) {
    const { t } = useTranslation();
    const schema = useParamSchema();
    const samplers = useParamOptions('sampler');
    const schedulers = useParamOptions('scheduler');
    const yoloModels = schema?.byId.get('yolomodelinternal')?.values ?? [];

    const fresh = (): SegmentForm => ({
        model: CLIP_SEG,
        textMatch: '',
        yoloId: 0,
        classIds: '',
        creativity: 0.6,
        threshold: 0.5,
        invert: false,
        genText: '',
        useSampler: false,
        sampler: samplers[0]?.value ?? '',
        useScheduler: false,
        scheduler: schedulers[0]?.value ?? ''
    });
    const [form, setForm] = useState<SegmentForm>(fresh);
    const [wasOpen, setWasOpen] = useState(props.open);
    // Reset on every open, as the legacy modal clears itself before it shows.
    if (props.open !== wasOpen) {
        setWasOpen(props.open);
        if (props.open) {
            setForm(fresh());
        }
    }
    const update = (patch: Partial<SegmentForm>) => setForm(current => ({ ...current, ...patch }));

    const isClipSeg = form.model === CLIP_SEG;
    const missingText = isClipSeg && !form.textMatch.trim();

    return (
        <SyntaxDialog
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t('promptTools.segment.title')}
            intro={t('promptTools.segment.intro')}
            docsUrl={DOCS_URL}
            docsLabel={t('promptTools.segment.docs')}
            canAdd={!missingText}
            error={missingText ? t('promptTools.segment.textRequired') : undefined}
            onAdd={() => props.onAdd(segmentSyntax(form))}
        >
            <SyntaxField label={t('promptTools.segment.model')} help={t('promptTools.segment.modelHelp')}>
                {id => (
                    <select id={id} value={form.model} onChange={e => update({ model: e.target.value })} className={`${SYNTAX_INPUT_CLASS} min-w-0 flex-1`}>
                        <option value={CLIP_SEG}>{t('promptTools.segment.clipSeg')}</option>
                        {yoloModels.map(model => (
                            <option key={model} value={`yolo-${model}`}>
                                {t('promptTools.segment.yoloModel', { model })}
                            </option>
                        ))}
                    </select>
                )}
            </SyntaxField>
            {isClipSeg ? (
                <SyntaxField label={t('promptTools.segment.textMatch')} help={t('promptTools.segment.textMatchHelp')}>
                    {id => (
                        <input
                            id={id}
                            type="text"
                            autoFocus
                            value={form.textMatch}
                            placeholder={t('promptTools.segment.textMatchPlaceholder')}
                            onChange={e => update({ textMatch: e.target.value })}
                            className={`${SYNTAX_INPUT_CLASS} min-w-0 flex-1`}
                        />
                    )}
                </SyntaxField>
            ) : (
                <>
                    <SyntaxField label={t('promptTools.segment.yoloId')} help={t('promptTools.segment.yoloIdHelp')}>
                        {id => (
                            <input
                                id={id}
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                value={form.yoloId}
                                onChange={e => update({ yoloId: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                                className={`${SYNTAX_INPUT_CLASS} w-20`}
                            />
                        )}
                    </SyntaxField>
                    <SyntaxField label={t('promptTools.segment.classIds')} help={t('promptTools.segment.classIdsHelp')}>
                        {id => (
                            <input
                                id={id}
                                type="text"
                                value={form.classIds}
                                placeholder={t('promptTools.segment.classIdsPlaceholder')}
                                onChange={e => update({ classIds: e.target.value })}
                                className={`${SYNTAX_INPUT_CLASS} min-w-0 flex-1`}
                            />
                        )}
                    </SyntaxField>
                </>
            )}
            <SyntaxField label={t('promptTools.segment.creativity')} help={t('promptTools.segment.creativityHelp')}>
                {id => <UnitSlider id={id} label={t('promptTools.segment.creativity')} value={form.creativity} step={0.05} onChange={creativity => update({ creativity })} />}
            </SyntaxField>
            <SyntaxField label={t('promptTools.segment.threshold')} help={t('promptTools.segment.thresholdHelp')}>
                {id => <UnitSlider id={id} label={t('promptTools.segment.threshold')} value={form.threshold} step={0.05} onChange={threshold => update({ threshold })} />}
            </SyntaxField>
            <SyntaxField label={t('promptTools.segment.invert')} help={t('promptTools.segment.invertHelp')}>
                {id => <input id={id} type="checkbox" checked={form.invert} onChange={e => update({ invert: e.target.checked })} className="accent-[var(--emphasis)]" />}
            </SyntaxField>
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
            <SyntaxField label={t('promptTools.segment.sampler')} help={t('promptTools.segment.samplerHelp')}>
                {id => (
                    <ToggledSelect
                        id={id}
                        label={t('promptTools.segment.sampler')}
                        enabled={form.useSampler}
                        onEnabledChange={useSampler => update({ useSampler })}
                        value={form.sampler}
                        options={samplers}
                        onChange={sampler => update({ sampler })}
                    />
                )}
            </SyntaxField>
            <SyntaxField label={t('promptTools.segment.scheduler')} help={t('promptTools.segment.schedulerHelp')}>
                {id => (
                    <ToggledSelect
                        id={id}
                        label={t('promptTools.segment.scheduler')}
                        enabled={form.useScheduler}
                        onEnabledChange={useScheduler => update({ useScheduler })}
                        value={form.scheduler}
                        options={schedulers}
                        onChange={scheduler => update({ scheduler })}
                    />
                )}
            </SyntaxField>
        </SyntaxDialog>
    );
}
