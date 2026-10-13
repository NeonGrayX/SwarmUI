/** Wires the remembered panel (./memory) to what only becomes known after load: the schema the
 *  restored values have to fit, and the user settings that govern remembering. */

import { useEffect } from 'react';
import { useUserSetting } from '@/settings/useUserSetting';
import { useParamSchema } from './schema';
import { pruneRestored, setKnownParams, setMemoryHours } from './memory';
import { useParamStore } from './store';

/** Whether `resetbatchsizetoone` has been applied for this page load. */
let batchReset = false;

/** Safe to call from several components at once: every step is idempotent. */
export function useParamMemory(): void {
    const schema = useParamSchema();
    const hours = useUserSetting<number | string | null>('parametermemorydurationhours', null);
    const resetBatch = useUserSetting<boolean | string | null>('resetbatchsizetoone', null);

    useEffect(() => {
        if (hours !== null) {
            setMemoryHours(Number(hours));
        }
    }, [hours]);

    useEffect(() => {
        if (!schema) {
            return;
        }
        setKnownParams(schema.params);
        const stale = pruneRestored(schema.byId);
        if (stale.length > 0) {
            useParamStore.getState().applyBundle(stale, {});
        }
    }, [schema]);

    // The existing interface puts the batch size back to 1 on every page load when asked to
    // (params.js:731), whatever was remembered.
    useEffect(() => {
        if (batchReset || resetBatch === null || !schema) {
            return;
        }
        batchReset = true;
        if ((resetBatch === true || resetBatch === 'true') && schema.byId.has('batchsize')) {
            useParamStore.getState().setValue('batchsize', 1);
        }
    }, [resetBatch, schema]);
}
