import { MediaField } from '@/components/form/MediaField';
import { useParamSchema } from '@/params/schema';
import { defaultValue, useParamStore } from '@/params/store';
import { useTranslation } from '@/i18n';

/** Images attached to the prompt itself, for models that read reference images (`promptimages`).
 *  The param is marked invisible in the schema because it belongs beside the prompt rather than in
 *  the parameter list. */
export function PromptAttachments() {
    const { t } = useTranslation();
    const schema = useParamSchema();
    // Only this param's slot, so edits to any other param do not re-render the attachments.
    const stored = useParamStore(s => s.values.promptimages);
    const isSet = useParamStore(s => 'promptimages' in s.values);
    const setValue = useParamStore(s => s.setValue);

    const param = schema?.byId.get('promptimages');
    if (!param) {
        return null;
    }

    return (
        // Full-width on a phone, where 14rem beside the Generate button leaves neither room.
        <div className="w-full shrink-0 sm:w-56">
            <MediaField
                param={param}
                value={isSet ? stored : defaultValue(param)}
                onChange={next => setValue(param.id, next)}
                inputId="composer-promptimages"
                emptyLabel={t('generate.attachImage')}
            />
        </div>
    );
}
