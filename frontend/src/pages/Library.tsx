import { ModelBrowser } from '@/components/library/ModelBrowser';
import { HistoryBrowser } from '@/components/library/HistoryBrowser';
import { PresetsBrowser } from '@/components/library/PresetsBrowser';
import type { ModelSubtype } from '@/library/types';

/** Maps a Library destination id to the model subtype ListModels expects. */
const DOWNLOAD_HINT = 'Download one, or check the model folder in Server \u2192 Configuration.';

const SUBTYPES: Record<string, { subtype: ModelSubtype; label: string; emptyHint: string }> = {
    models: { subtype: 'Stable-Diffusion', label: 'models', emptyHint: DOWNLOAD_HINT },
    loras: { subtype: 'LoRA', label: 'LoRAs', emptyHint: DOWNLOAD_HINT },
    vaes: { subtype: 'VAE', label: 'VAEs', emptyHint: DOWNLOAD_HINT },
    embeddings: { subtype: 'Embedding', label: 'embeddings', emptyHint: DOWNLOAD_HINT },
    controlnets: { subtype: 'ControlNet', label: 'ControlNets', emptyHint: DOWNLOAD_HINT },
    // Wildcards are authored locally rather than downloaded.
    wildcards: {
        subtype: 'Wildcards',
        label: 'wildcards',
        emptyHint: 'Wildcards are text files in the Wildcards folder, one option per line.'
    }
};

/** One Library screen. All eight asset types share this shell and get the full viewport height,
 *  rather than the ~300px bottom strip they had in the legacy UI. */
export function LibraryPage(props: { destinationId: string }) {
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
    return <ModelBrowser subtype={entry.subtype} label={entry.label} emptyHint={entry.emptyHint} />;
}
