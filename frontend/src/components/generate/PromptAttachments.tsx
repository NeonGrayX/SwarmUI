import { MediaField } from '@/components/form/MediaField';
import { useParamSchema } from '@/params/schema';
import { useParamStore, valueOf } from '@/params/store';
import { useTranslation } from '@/i18n';

/** Images attached to the prompt itself, for models that read reference images (`promptimages`).
 *
 * The param is marked invisible in the schema because the legacy UI renders it outside the param
 * list too - as thumbnails in the prompt region, fed by the paste box and the "Use As Image Prompt"
 * button (addPromptMediaToInput, src/wwwroot/js/genpage/gentab/params.js:973). Same idea here, with
 * one control that also accepts drops and clicks. */
export function PromptAttachments() {
    const { t } = useTranslation();
    const schema = useParamSchema();
    const values = useParamStore(s => s.values);
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
                value={valueOf(param, values)}
                onChange={next => setValue(param.id, next)}
                inputId="composer-promptimages"
                emptyLabel={t('generate.attachImage')}
            />
        </div>
    );
}
