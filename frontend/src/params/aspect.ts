/** Aspect ratio driving width and height, as in the existing interface.
 *
 * A named ratio is not something the server resolves on its own unless Side Length is switched on
 * (GetImageWidth, src/Text2Image/T2IParamInput.cs:232) - otherwise it reads width and height. So,
 * as resTrick does (params.js:603), picking a ratio writes width and height here: scaled from the
 * model's native resolution, or from the side length when that is switched on. Width and height are
 * hidden meanwhile (see ./visibility), and come back at 'Custom'.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { ModelCard } from '@/library/types';
import { useCurrentModel } from '@/library/catalog';
import type { NormalizedSchema } from './schema';
import { defaultValue, useParamStore, valueOf } from './store';

type AltLogic = (width: number, height: number) => [number, number] | null;

interface AspectRatio {
    width: number;
    height: number;
    /** A model-specific exact size, eg Wan's 832x480, used instead of the scaled one. */
    alt?: AltLogic;
}

/** The existing table gives 3:2 and 2:3 the same exception, kept as it is. */
const KEEP_768_512: AltLogic = (w, h) => (w === 768 && h === 512 ? [768, 512] : null);
const WAN_16_9: AltLogic = (w, h) => (w === 640 && h === 640 ? [832, 480] : w === 960 && h === 960 ? [1280, 720] : null);
const WAN_9_16: AltLogic = (w, h) => (w === 640 && h === 640 ? [480, 832] : w === 960 && h === 960 ? [720, 1280] : null);

/** Mirrors the `aspectRatios` table (params.js:68), which the server's ResolutionAspectReferences
 *  also matches. */
const ASPECT_RATIOS: Record<string, AspectRatio> = {
    '1:1': { width: 512, height: 512 },
    '4:3': { width: 576, height: 448 },
    '3:2': { width: 608, height: 416, alt: KEEP_768_512 },
    '8:5': { width: 608, height: 384 },
    '16:9': { width: 672, height: 384, alt: WAN_16_9 },
    '21:9': { width: 768, height: 320 },
    '3:4': { width: 448, height: 576 },
    '2:3': { width: 416, height: 608, alt: KEEP_768_512 },
    '5:8': { width: 384, height: 608 },
    '9:16': { width: 384, height: 672, alt: WAN_9_16 },
    '9:21': { width: 320, height: 768 }
};

function roundTo(value: number, step: number): number {
    return step === 0 ? value : Math.round(value / step) * step;
}

/** Width and height for a ratio around a base size, or null for an unknown ratio. Mirrors
 *  AspectRatio.read (params.js:49), and its math has to keep matching GetImageWidth. */
export function aspectSize(
    id: string,
    baseWidth: number,
    baseHeight: number,
    precision: number,
    useAlt: boolean
): [number, number] | null {
    const ratio = ASPECT_RATIOS[id];
    if (!ratio) {
        return null;
    }
    if (ratio.alt && useAlt && precision === 16) {
        const exact = ratio.alt(baseWidth, baseHeight);
        if (exact) {
            return exact;
        }
    }
    let width = baseWidth;
    let height = baseHeight;
    if (width !== height) {
        width = roundTo(Math.sqrt(width * height), precision);
        height = width;
    }
    return [
        roundTo((ratio.width * (width <= 0 ? 512 : width)) / 512, precision),
        roundTo((ratio.height * (height <= 0 ? 512 : height)) / 512, precision)
    ];
}

/** The selected model's native resolution, from its metadata. `pending` while that is loading. */
function useNativeResolution(name: string): { size: [number, number] | null; pending: boolean } {
    const query = useQuery({
        queryKey: ['describe-model', 'Stable-Diffusion', name],
        queryFn: () => api.post<{ model?: ModelCard }>('DescribeModel', { modelName: name }),
        enabled: name !== '',
        staleTime: 5 * 60 * 1000,
        retry: false
    });
    if (name === '') {
        return { size: null, pending: false };
    }
    const model = query.data?.model;
    return {
        size: model ? [model.standard_width || 0, model.standard_height || 0] : null,
        pending: query.isPending
    };
}

/** Keeps width and height on the selected ratio. Mount once per panel; a second mount writes the
 *  same values, so it does no harm. */
export function useAspectRatioSync(schema: NormalizedSchema | null): void {
    const aspect = useParamStore(s => s.values.aspectratio);
    const sideOn = useParamStore(s => s.toggles.sidelength === true);
    const side = useParamStore(s => s.values.sidelength);
    const model = useCurrentModel();
    const native = useNativeResolution(model.name);
    const precision = (model.compatClass ? schema?.compatClasses[model.compatClass]?.resolution_precision : 0) || 16;
    const nativeWidth = native.size?.[0] ?? 0;
    const nativeHeight = native.size?.[1] ?? 0;

    useEffect(() => {
        const aspectParam = schema?.byId.get('aspectratio');
        const widthParam = schema?.byId.get('width');
        const heightParam = schema?.byId.get('height');
        if (!schema || !aspectParam || !widthParam || !heightParam || native.pending) {
            return;
        }
        const state = useParamStore.getState();
        const ratio = String(valueOf(aspectParam, state.values));
        if (ratio === 'Custom') {
            return;
        }
        let base: [number, number] = [nativeWidth, nativeHeight];
        let useAlt = true;
        const sideParam = schema.byId.get('sidelength');
        const sideLength = sideParam ? Number(valueOf(sideParam, state.values)) : 0;
        if (sideParam && sideOn && sideLength) {
            base = [sideLength, sideLength];
            useAlt = false;
        }
        // A model whose size could not be looked up (not installed here, say) would otherwise fall
        // back to a 512 base and clobber the resolution that reuse or saved settings just restored.
        else if (model.name && (!nativeWidth || !nativeHeight)) {
            return;
        }
        const size = aspectSize(ratio, base[0], base[1], precision, useAlt);
        if (!size) {
            return;
        }
        if (Number(valueOf(widthParam, state.values)) === size[0] && Number(valueOf(heightParam, state.values)) === size[1]) {
            return;
        }
        useParamStore.setState(s => ({ values: { ...s.values, width: size[0], height: size[1] } }));
    }, [schema, aspect, sideOn, side, model.name, nativeWidth, nativeHeight, native.pending, precision]);
}

/** The resolution the panel is set to, for showing beside the ratio. */
export function useResolution(schema: NormalizedSchema | null): [number, number] {
    const width = useParamStore(s => s.values.width);
    const height = useParamStore(s => s.values.height);
    const widthParam = schema?.byId.get('width');
    const heightParam = schema?.byId.get('height');
    return [
        widthParam ? Number(width === undefined ? defaultValue(widthParam) : width) : 0,
        heightParam ? Number(height === undefined ? defaultValue(heightParam) : height) : 0
    ];
}

/** Swaps width and height, in one store write. */
export function swapResolution(schema: NormalizedSchema | null): void {
    const widthParam = schema?.byId.get('width');
    const heightParam = schema?.byId.get('height');
    if (!widthParam || !heightParam) {
        return;
    }
    useParamStore.setState(s => ({
        values: { ...s.values, width: valueOf(heightParam, s.values), height: valueOf(widthParam, s.values) }
    }));
}
