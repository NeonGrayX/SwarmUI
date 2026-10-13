/** The one way a generation is kicked off from the UI: build the request, check it, send it. */

import { useCallback } from 'react';
import { editorOverrides } from '@/editor/store';
import type { NormalizedSchema } from '@/params/schema';
import { useParamSchema } from '@/params/schema';
import { defaultValue, useParamStore } from '@/params/store';
import { useGenInput } from './input';
import { useGenerateStore } from './store';
import { validateGenInput } from './validate';

/** Fallback creativity for an editor run, when the param carries no usable default. */
const DEFAULT_INIT_IMAGE_CREATIVITY = 0.6;

/** Replaces the init image, mask and output size with the image editor's, when it is open.
 *
 * The editor *is* the init image while it is showing, which is why its `initimage` and `maskimage`
 * params are hidden from the panel (see `computeVisibility`) - there would be two answers to the
 * same question otherwise. */
function applyEditorOverrides(input: Record<string, unknown>, schema: NormalizedSchema | null): void {
    const editor = editorOverrides();
    if (!editor) {
        return;
    }
    input.initimage = editor.initImage;
    input.maskimage = editor.maskImage;
    input.width = editor.width;
    input.height = editor.height;
    // Without some creativity an init image is returned unchanged, so a run from the editor that
    // never touched the slider would look like it had done nothing at all.
    if (input.initimagecreativity === undefined) {
        const param = schema?.byId.get('initimagecreativity');
        // `defaultValue` falls back to a param's minimum, which for creativity is zero - and zero
        // creativity returns the init image untouched, so treat that as "no default given".
        const fromSchema = param ? Number(defaultValue(param)) : NaN;
        input.initimagecreativity = fromSchema > 0 ? fromSchema : DEFAULT_INIT_IMAGE_CREATIVITY;
    }
    const extra = (input.extra_metadata ?? {}) as Record<string, unknown>;
    input.extra_metadata = { ...extra, used_image_editor: 'true' };
}

/** The model name a run sends when it has none of its own to send. A recognised sentinel rather
 *  than an omission: the server reads it as "this workflow loads its own" and skips the model
 *  pressure it would otherwise apply to a backend (BackendHandler.cs:755). */
const NO_MODEL = '(none)';

export interface StartOptions {
    /** True for a run driven by a custom Comfy workflow, whose graph names its own checkpoint.
     *  Mirrors SimpleTabGenerateHandler in the existing interface, which turns the model check off
     *  and sends `(none)` (simpletab.js:getGenInput). */
    modelOptional?: boolean;
    /** For "Generate Forever": when the seed and variation seed are both fixed, a run whose input
     *  matches the previous one would only reproduce the same image, so it is skipped rather than
     *  sent (generatecontrols.js doGenForeverOnce). */
    skipRepeatWithFixedSeed?: boolean;
}

/** The input of the last run sent by a `skipRepeatWithFixedSeed` caller. */
let lastRepeatInput: string | null = null;

/** Forgets the last repeat-checked input, so a fresh "Generate Forever" session always sends its
 *  first run even when nothing changed since the previous session. */
export function resetRepeatSkip(): void {
    lastRepeatInput = null;
}

/** Starts a run, or records why it could not start. Reads the param store at call time so the
 *  Generate button does not re-render on every keystroke, the same way useGenInput does. */
export function useStartGenerate(options: StartOptions = {}): () => void {
    const schema = useParamSchema();
    const buildInput = useGenInput();
    const modelOptional = options.modelOptional ?? false;
    const skipRepeat = options.skipRepeatWithFixedSeed ?? false;
    return useCallback(() => {
        const input = buildInput();
        applyEditorOverrides(input, schema);
        if (modelOptional && !String(input.model ?? '').trim()) {
            input.model = NO_MODEL;
        }
        const images = Number(useParamStore.getState().values.images ?? 1);
        const issue = validateGenInput(schema, input, images, modelOptional);
        const store = useGenerateStore.getState();
        if (issue) {
            store.fail(issue);
            return;
        }
        // An absent variation seed counts as fixed, as it does in the legacy check.
        const fixedVariation = input.variationseed === undefined || Number(input.variationseed) !== -1;
        if (skipRepeat && Number(input.seed ?? -1) !== -1 && fixedVariation) {
            const serialized = JSON.stringify({ images, input });
            if (serialized === lastRepeatInput) {
                return;
            }
            lastRepeatInput = serialized;
        }
        store.start(images, input);
    }, [schema, buildInput, modelOptional, skipRepeat]);
}
