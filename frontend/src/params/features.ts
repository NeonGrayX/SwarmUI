/** The feature flags a param's `feature_flag` is checked against.
 *
 * Two sources feed it. GetCurrentStatus reports what the connected backends can do (`comfyui`,
 * `ipadapter`, ...), but a set of flags only the client can answer: whether the *selected model*
 * supports a thing - `sdxl` for Revision, `text2video` for the Text2Video group, `krea-2`'s
 * reference latents. No backend reports those, so without them every param gated on one would stay
 * hidden whatever model is picked.
 */

import { useMemo } from 'react';
import { useCurrentStatus, useSession } from '@/api/hooks';
import { useCurrentModel } from '@/library/catalog';

/** One model-derived flag, set when the current model's compat class (or, for `arch`, its
 *  architecture id) starts with any of the listed prefixes.
 *
 * Ported from reviseBackendFeatureSet (src/wwwroot/js/genpage/main.js:174). Its prefix matching is
 * kept as-is: 'stable-diffusion-v3' is meant to cover the 3.5 variants too. Extensions can add
 * their own rules there through `featureSetChangers`, which this UI has no equivalent of. */
interface ModelFeatureRule {
    flag: string;
    compat?: string[];
    arch?: string[];
}

const MODEL_FEATURES: ModelFeatureRule[] = [
    { flag: 'sd3', compat: ['stable-diffusion-v3'] },
    { flag: 'cascade', compat: ['stable-cascade-v1'] },
    { flag: 'flux-dev', arch: ['Flux.1-dev', 'flux.2-dev', 'flux.2-klein-4b', 'flux.2-klein-9b', 'hunyuan-video'] },
    { flag: 'optional_reference_latent', compat: ['krea-2'] },
    { flag: 'sdxl', compat: ['stable-diffusion-xl-v1'] },
    { flag: 'model_has_ipadapter', compat: ['stable-diffusion-v1', 'stable-diffusion-xl-v1'] },
    { flag: 'supports_reference_only', compat: ['stable-diffusion-v1', 'stable-diffusion-v2', 'stable-diffusion-xl-v1'] },
    { flag: 'supports_hypertile', compat: ['stable-diffusion-v1', 'stable-diffusion-v2', 'stable-diffusion-xl-v1'] },
    {
        flag: 'text2video',
        compat: [
            'genmo-mochi-1',
            'lightricks-ltx-video',
            'hunyuan-video',
            'nvidia-cosmos-1',
            'wan-21',
            'wan-22',
            'kandinsky5-vidlite',
            'kandinsky5-vidpro',
            'minimax-h3'
        ]
    },
    { flag: 'text2audio', compat: ['ace-step-1_5', 'minimax-music-3'] }
];

const MODEL_FLAGS = new Set(MODEL_FEATURES.map(rule => rule.flag));

function startsWithAny(value: string | null, prefixes: string[] | undefined): boolean {
    return value !== null && (prefixes ?? []).some(prefix => value.startsWith(prefix));
}

/** The backend's flags with the model-derived ones decided by the current model instead. A
 *  model-derived flag the backend happened to report is dropped when the model does not qualify,
 *  as legacy's removal list does. */
export function withModelFeatures(
    backendFeatures: string[],
    model: { architecture: string | null; compatClass: string | null }
): string[] {
    const features = backendFeatures.filter(flag => !MODEL_FLAGS.has(flag));
    for (const rule of MODEL_FEATURES) {
        if (startsWithAny(model.compatClass, rule.compat) || startsWithAny(model.architecture, rule.arch)) {
            features.push(rule.flag);
        }
    }
    return features;
}

/** Every feature flag currently supported: the backends' plus the selected model's. */
export function useSupportedFeatures(): string[] {
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const backendFeatures = status.data?.supported_features;
    const { architecture, compatClass } = useCurrentModel();
    return useMemo(
        () => withModelFeatures(backendFeatures ?? [], { architecture, compatClass }),
        [backendFeatures, architecture, compatClass]
    );
}
