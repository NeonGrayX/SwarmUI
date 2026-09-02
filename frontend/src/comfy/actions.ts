/** The data and operations behind the Comfy workflow toolbar.
 *
 * Kept out of the components so that building a parameter set from the live editor - the one piece
 * with real logic - is reachable from anywhere and testable on its own.
 */

import { useCallback } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useSession, useT2IParams, useUserSettings } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { cleanModelName } from '@/params/schema';
import { fetchObjectInfo, graphToPrompt, type ComfyGraph, type ComfyPrompt } from './bridge';
import { buildComfyParams, type ComfyWorkflowInput } from './params';
import { fetchSavedWorkflow, savedWorkflowInput } from './saved';
import { useComfyWorkflowStore, type ComfyWorkflowSource } from './store';

export const comfyKeys = {
    objectInfo: ['comfy-object-info'] as const,
    workflows: ['comfy-workflows'] as const
};

/** One entry of the saved workflow library (ComfyListWorkflows). */
export interface SavedWorkflow {
    name: string;
    image: string;
    description: string;
    enable_in_simple: boolean;
}

/** Everything a build of the current editor graph produces. */
export interface ComfyBuildResult {
    input: ComfyWorkflowInput;
    /** UI-format graph, which is what the workflow library stores and reopens. */
    workflow: ComfyGraph;
    /** API-format prompt, rewritten with `${id:default}` placeholders. */
    prompt: ComfyPrompt;
}

/** Node class definitions from the live Comfy backend. Needed to know an input's real type and
 *  range, which the graph itself does not carry. */
export function useComfyObjectInfo(enabled: boolean) {
    return useQuery({
        queryKey: comfyKeys.objectInfo,
        queryFn: fetchObjectInfo,
        // Changes only when custom nodes or models are installed.
        staleTime: 5 * 60 * 1000,
        enabled
    });
}

/** The user's saved workflows. */
export function useSavedWorkflows(enabled: boolean): UseQueryResult<{ workflows: SavedWorkflow[] }> {
    return useQuery({
        queryKey: comfyKeys.workflows,
        queryFn: () => api.post<{ workflows: SavedWorkflow[] }>('ComfyListWorkflows', {}),
        enabled
    });
}

/** Converts whatever is currently open in the Comfy editor into a Swarm parameter set.
 *
 * `requireSave` is true when the result is destined for generation: the graph then has to end in
 * an image-saving node, which gets swapped for Swarm's streaming variant. */
export function useComfyBuilder(): (requireSave: boolean) => Promise<ComfyBuildResult> {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const canReadUserSettings = usePermission('read_user_settings');
    const settings = useUserSettings(session.isSuccess && canReadUserSettings);
    const objectInfo = useComfyObjectInfo(session.isSuccess);

    const knownParamIds = params.data?.list;
    const checkpoints = params.data?.models['Stable-Diffusion'];
    const resetBatchSizeToOne = settings.data?.settings.ResetBatchSizeToOne?.value === true;
    const objectInfoData = objectInfo.data;

    return useCallback(
        async (requireSave: boolean) => {
            const { workflow, prompt } = await graphToPrompt();
            // The definitions are worth waiting for rather than skipping: without them every
            // numeric input would fall back to an untyped decimal with no range.
            const info = objectInfoData ?? (await fetchObjectInfo());
            const input = buildComfyParams({
                workflow,
                prompt,
                objectInfo: info,
                knownParamIds: new Set((knownParamIds ?? []).map(p => p.id)),
                allModels: (checkpoints ?? []).map(entry => cleanModelName(entry[0])),
                resetBatchSizeToOne,
                requireSave
            });
            return { input, workflow, prompt };
        },
        [objectInfoData, knownParamIds, checkpoints, resetBatchSizeToOne]
    );
}

/** Opens a saved workflow straight into the Generate panel, with no Comfy editor in between.
 *
 * The library stored the parameter set alongside the graph, so this needs neither the editor nor a
 * running Comfy backend - which is the whole point: a workflow someone else built is meant to be
 * usable as a set of controls, not as a graph to be understood first.
 */
export function useOpenSavedWorkflow(source: ComfyWorkflowSource): (name: string) => Promise<void> {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const activate = useComfyWorkflowStore(s => s.activate);
    const knownParamIds = params.data?.list;

    return useCallback(
        async (name: string) => {
            const data = await fetchSavedWorkflow(name);
            const known = new Set((knownParamIds ?? []).map(p => p.id));
            activate(savedWorkflowInput(data, known), name, null, source);
        },
        [knownParamIds, activate, source]
    );
}
