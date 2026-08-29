import { ModelBrowser } from '@/components/library/ModelBrowser';
import { HistoryBrowser } from '@/components/library/HistoryBrowser';
import { PresetsBrowser } from '@/components/library/PresetsBrowser';
import type { ModelSubtype } from '@/library/types';
import { subtypeNoun } from '@/library/catalog';
import { useTranslation } from '@/i18n';

/** Maps a Library destination id to the model subtype ListModels expects, and to the hint shown
 *  when that folder is empty. The display noun comes from `subtypeNoun`, so the browsers and the
 *  Generate-page pickers name the same asset the same way. */
const SUBTYPES: Record<string, { subtype: ModelSubtype; emptyHintKey: string }> = {
    models: { subtype: 'Stable-Diffusion', emptyHintKey: 'library.emptyHint.download' },
    loras: { subtype: 'LoRA', emptyHintKey: 'library.emptyHint.download' },
    vaes: { subtype: 'VAE', emptyHintKey: 'library.emptyHint.download' },
    embeddings: { subtype: 'Embedding', emptyHintKey: 'library.emptyHint.download' },
    controlnets: { subtype: 'ControlNet', emptyHintKey: 'library.emptyHint.download' },
    // Wildcards are authored locally rather than downloaded.
    wildcards: { subtype: 'Wildcards', emptyHintKey: 'library.emptyHint.wildcards' }
};

/** One Library screen, picked by destination id: history and presets have browsers of their own,
 *  everything else is <ModelBrowser> over the subtype below. */
export function LibraryPage(props: { destinationId: string }) {
    const { t } = useTranslation();
    if (props.destinationId === 'history') {
        return <HistoryBrowser />;
    }
    if (props.destinationId === 'presets') {
        return <PresetsBrowser />;
    }
    const entry = SUBTYPES[props.destinationId];
    if (!entry) {
        return null;
    }
    return (
        <ModelBrowser
            subtype={entry.subtype}
            label={subtypeNoun(entry.subtype)}
            emptyHint={t(entry.emptyHintKey)}
        />
    );
}
