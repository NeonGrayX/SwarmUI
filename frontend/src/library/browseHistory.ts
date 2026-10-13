/** "Browse history": from a model, LoRA, embedding, wildcard or preset to the images that used it.
 *
 * Ported from browseModelHistory (src/wwwroot/js/genpage/gentab/models.js). It is nothing more than
 * a history search for the metadata line that records the use - `model: <name>`, `loras: <name>` -
 * which the history search matches as `key: value` (imageSearchText in ./types).
 */

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { cleanModelName } from '@/params/schema';

/** The metadata key each model subtype's uses are recorded under. VAEs and ControlNets have none
 *  that names them, so they get no action. */
const SUBTYPE_KEYS: Partial<Record<string, string>> = {
    'Stable-Diffusion': 'model',
    LoRA: 'loras',
    Embedding: 'used_embeddings',
    Wildcards: 'used_wildcards'
};

/** Extra-data key listing the presets a generation applied, by title. */
export const PRESET_HISTORY_KEY = 'presets_used';

export function historyKeyForSubtype(subtype: string): string | undefined {
    return SUBTYPE_KEYS[subtype];
}

/** Opens the history searched for images whose `key` metadata names `name`. */
export function useBrowseHistory(): (key: string, name: string) => void {
    const navigate = useNavigate();
    return useCallback(
        (key: string, name: string) => {
            // Metadata records models without their extension, as the params spell them.
            void navigate({ to: '/library/history', search: { search: `${key}: ${cleanModelName(name)}` } });
        },
        [navigate]
    );
}
