/** Starring things the server has no starring route for: saved workflows, and presets.
 *
 * The server needs no such route: the map behind SetStarredModels is stored exactly as it is
 * handed over (src/WebAPI/BasicAPIFeatures.cs:429) and handed back whole by GetMyUserData, so
 * anything that can be named keeps its stars in a bucket of that map, alongside the model
 * subtypes. Every writer of the map read-modify-writes all of it - this UI's `useToggleStar` and
 * the legacy one's toggleStar (src/wwwroot/js/genpage/gentab/models.js:605) - which is what lets a
 * bucket neither of them treats as a subtype ride along untouched.
 *
 * Stars therefore follow the user rather than the browser, which is the point: which workflows and
 * presets someone reaches for is worth keeping across machines.
 */

import { useMemo } from 'react';
import { useMyUserData, useToggleStar } from './hooks';

/** The buckets these stars live in. Model subtypes are registered names like 'Stable-Diffusion' or
 *  'LoRA', so the underscores keep these clear of every one of them. */
const WORKFLOW_BUCKET = '__workflows';
const PRESET_BUCKET = '__presets';

export interface Stars {
    isStarred: (name: string) => boolean;
    toggle: (name: string) => void;
    /** How many entries are starred, so a filter that would empty a list can say why. */
    count: number;
}

/** The user's stars in one bucket, and the toggle that adds to them.
 *
 * A star that names something which has since been deleted simply never matches anything, the same
 * way a deleted model's star does. */
function useBucketStars(bucket: string, enabled: boolean): Stars {
    const userData = useMyUserData(enabled);
    const toggleStar = useToggleStar();
    const starred = userData.data?.starred_models?.[bucket];
    const { mutate } = toggleStar;

    return useMemo(() => {
        const names = new Set(starred ?? []);
        return {
            isStarred: (name: string) => names.has(name),
            toggle: (name: string) => mutate({ bucket, name }),
            count: names.size
        };
    }, [bucket, starred, mutate]);
}

/** Stars on saved Comfy workflows, keyed by workflow name. */
export function useWorkflowStars(enabled = true): Stars {
    return useBucketStars(WORKFLOW_BUCKET, enabled);
}

/** Stars on saved presets, keyed by preset title - which is what the preset routes identify one
 *  by, so a rename is a new preset here as it is everywhere else. */
export function usePresetStars(enabled = true): Stars {
    return useBucketStars(PRESET_BUCKET, enabled);
}
