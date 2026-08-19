/** The one way a generation is kicked off from the UI: build the request, check it, send it. */

import { useCallback } from 'react';
import { useParamSchema } from '@/params/schema';
import { useParamStore } from '@/params/store';
import { useGenInput } from './input';
import { useGenerateStore } from './store';
import { validateGenInput } from './validate';

/** Starts a run, or records why it could not start. Reads the param store at call time so the
 *  Generate button does not re-render on every keystroke, the same way useGenInput does. */
export function useStartGenerate(): () => void {
    const schema = useParamSchema();
    const buildInput = useGenInput();
    return useCallback(() => {
        const input = buildInput();
        const images = Number(useParamStore.getState().values.images ?? 1);
        const issue = validateGenInput(schema, input, images);
        const store = useGenerateStore.getState();
        if (issue) {
            store.fail(issue);
            return;
        }
        store.start(images, input);
    }, [schema, buildInput]);
}
