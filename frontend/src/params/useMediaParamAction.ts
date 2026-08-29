/** Sending an image somewhere from outside the param panel - "Use as init image" and friends.
 *  One call: inline the data, record its metadata, and switch the param and its groups on.
 */

import { useCallback } from 'react';
import { useParamSchema } from './schema';
import { kindOfValue, mediaKindOf, mediaValues, urlToDataUrl, isMediaListType } from './media';
import { useParamStore } from './store';

export interface MediaParamAction {
    /** Whether the target param exists in this server's schema. */
    available: (paramId: string) => boolean;
    set: (paramId: string, url: string) => Promise<void>;
}

export function useMediaParamAction(): MediaParamAction {
    const schema = useParamSchema();

    const available = useCallback((paramId: string) => Boolean(schema?.byId.get(paramId)), [schema]);

    const set = useCallback(
        async (paramId: string, url: string) => {
            const param = schema?.byId.get(paramId);
            if (!param) {
                throw new Error(`This server has no "${paramId}" parameter.`);
            }
            const data = await urlToDataUrl(url);
            const meta = {
                // A data URL has no file name to take; anything else is a view path ending in one.
                name: url.startsWith('data:') ? 'generated image' : url.slice(url.lastIndexOf('/') + 1),
                kind: kindOfValue(data, mediaKindOf(param.type))
            };

            const store = useParamStore.getState();
            if (isMediaListType(param.type)) {
                // List params accumulate: dropping a second image adds to the prompt, it does not
                // replace the first.
                const existing = mediaValues(store.values[param.id]);
                store.setValue(param.id, [...existing, data]);
                store.setMedia(param.id, [...(store.media[param.id] ?? []).slice(0, existing.length), meta]);
            }
            else {
                store.setValue(param.id, data);
                store.setMedia(param.id, [meta]);
            }

            if (param.toggleable) {
                store.setToggle(param.id, true);
            }
            // Init image lives in a group with a master toggle; setting the value without it would
            // silently do nothing at generation time.
            let group = param.group ? schema?.groupsById.get(param.group) : undefined;
            while (group) {
                if (group.toggles) {
                    store.setGroupToggle(group.id, true);
                }
                store.setGroupOpen(group.id, true);
                group = group.parent ? schema?.groupsById.get(group.parent) : undefined;
            }
        },
        [schema]
    );

    return { available, set };
}
