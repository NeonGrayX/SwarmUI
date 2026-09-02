/** Starring a saved workflow.
 *
 * The server has no workflow-starring route, and needs none: the map behind SetStarredModels is
 * stored exactly as it is handed over (src/WebAPI/BasicAPIFeatures.cs:429) and handed back whole by
 * GetMyUserData, so the workflow library keeps its stars in a bucket of that map, alongside the
 * model subtypes. Every writer of the map read-modify-writes all of it - this UI's `useToggleStar`
 * and the legacy one's toggleStar (src/wwwroot/js/genpage/gentab/models.js:605) - which is what
 * lets a bucket neither of them treats as a subtype ride along untouched.
 *
 * Stars therefore follow the user rather than the browser, which is the point: which workflows
 * someone reaches for is worth keeping across machines.
 */

import { useMemo } from 'react';
import { useMyUserData, useToggleStar } from '@/library/hooks';

/** The bucket the workflow stars live in. Model subtypes are registered names like
 *  'Stable-Diffusion' or 'LoRA', so the underscores keep this one clear of every one of them. */
const WORKFLOW_BUCKET = '__workflows';

export interface WorkflowStars {
    isStarred: (name: string) => boolean;
    toggle: (name: string) => void;
    /** How many workflows are starred, so a filter that would empty the list can say why. */
    count: number;
}

/** The user's starred workflows, and the toggle that adds to them.
 *
 * A star that names a workflow which has since been deleted simply never matches anything, the
 * same way a deleted model's star does. */
export function useWorkflowStars(enabled = true): WorkflowStars {
    const userData = useMyUserData(enabled);
    const toggleStar = useToggleStar();
    const starred = userData.data?.starred_models?.[WORKFLOW_BUCKET];
    const { mutate } = toggleStar;

    return useMemo(() => {
        const names = new Set(starred ?? []);
        return {
            isStarred: (name: string) => names.has(name),
            toggle: (name: string) => mutate({ bucket: WORKFLOW_BUCKET, name }),
            count: names.size
        };
    }, [starred, mutate]);
}
