/** Data access for the Library browsers. */

import {
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient,
    type UseQueryResult
} from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
import { cleanModelName } from '@/params/schema';
import { isPlaceholderImage } from './types';
import type {
    ImageEntry,
    ImageSortMode,
    ListImagesResponse,
    ListModelsResponse,
    ModelSubtype,
    MyUserData,
    SortMode
} from './types';

export const libraryKeys = {
    models: (subtype: string, path: string, sort: SortMode, reverse: boolean, depth: number) =>
        ['models', subtype, path, sort, reverse, depth] as const,
    images: (path: string, sort: string, reverse: boolean, depth: number, filter = '') =>
        ['images', path, sort, reverse, depth, filter] as const,
    userData: ['user-data'] as const,
    /** One wildcard's full text. ListModels cuts each wildcard's `raw` off at 512 characters. */
    wildcard: (name: string) => ['wildcard', name] as const
};

export function useModels(
    subtype: ModelSubtype,
    path: string,
    sort: SortMode,
    reverse: boolean,
    depth: number,
    enabled = true
): UseQueryResult<ListModelsResponse> {
    return useQuery({
        queryKey: libraryKeys.models(subtype, path, sort, reverse, depth),
        enabled,
        queryFn: () =>
            api.post<ListModelsResponse>('ListModels', {
                path,
                depth,
                subtype,
                sortBy: sort,
                sortReverse: reverse,
                // URLs rather than inline base64 keep the payload small for large libraries.
                dataImages: false
            }),
        staleTime: 60_000
    });
}

/** One folder's image listing. With a `filter`, the server does the searching: it scans up to the
 *  user's MaxImagesScannedInHistory rather than stopping at MaxImagesInHistory, and returns only
 *  what matches - reaching images the plain listing was cut off before. */
export function useImages(
    path: string,
    sort: ImageSortMode,
    reverse: boolean,
    depth: number,
    filter = '',
    enabled = true
): UseQueryResult<ListImagesResponse> {
    return useQuery({
        queryKey: libraryKeys.images(path, sort, reverse, depth, filter),
        queryFn: () =>
            api.post<ListImagesResponse>('ListImages', {
                path,
                depth,
                sortBy: sort,
                sortReverse: reverse,
                ...(filter ? { filter } : {})
            }),
        enabled,
        staleTime: 30_000,
        // Every search typed is its own listing of up to thousands of entries; nothing is gained
        // by holding on to the ones the user has typed past.
        ...(filter ? { gcTime: 30_000 } : {})
    });
}

/** The star map as GetMyUserData hands it back, made safe to index.
 *
 * Earlier builds of this UI sent SetStarredModels `{ raw: map }`. The route binds its JObject to
 * the whole request body (APICallReflectBuilder.cs), so that stored the map one level down under a
 * `raw` key, where no subtype lookup finds it - and every later toggle wrapped it again. Folding
 * those levels back in brings the stars back, and the next toggle writes the map out flat. */
function flattenStarred(raw: unknown): Record<string, string[]> {
    const flat: Record<string, string[]> = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return flat;
    }
    const record = raw as Record<string, unknown>;
    const nested = record.raw;
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
        Object.assign(flat, flattenStarred(nested));
    }
    for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
            flat[key] = value.map(String);
        }
    }
    return flat;
}

async function fetchMyUserData(): Promise<MyUserData> {
    const data = await api.post<MyUserData>('GetMyUserData');
    return {
        ...data,
        starred_models: flattenStarred(data.starred_models),
        model_preset_links: data.model_preset_links ?? {}
    };
}

export function useMyUserData(enabled = true): UseQueryResult<MyUserData> {
    return useQuery({
        queryKey: libraryKeys.userData,
        queryFn: fetchMyUserData,
        staleTime: 60_000,
        enabled
    });
}

/** The star map with one name flipped in one bucket. */
function toggledStars(starred: Record<string, string[]>, bucket: string, name: string): Record<string, string[]> {
    const next = { ...starred };
    const list = next[bucket] ?? [];
    next[bucket] = list.includes(name) ? list.filter(n => n !== name) : [...list, name];
    return next;
}

/** Toggles one name's starred state within a bucket of the user's star map.
 *
 * `bucket` is a model subtype for models, but the map itself is untyped: SetStarredModels stores
 * whatever object it is handed (src/WebAPI/BasicAPIFeatures.cs:429) and GetMyUserData reads the
 * whole thing back, so things that are not models can keep stars in a bucket of their own - see
 * `useWorkflowStars` and `usePresetStars` in src/library/stars.ts.
 *
 * SetStarredModels replaces the whole map, so every writer read-modify-writes it, this UI and the
 * legacy one alike (src/wwwroot/js/genpage/gentab/models.js:605), which is what lets buckets one
 * of them has never heard of survive the other's writes.
 *
 * The toggle lands in the cache straight away, and the writes share one mutation scope so they go
 * out one at a time, each sending the map as it stands by then. Two quick toggles therefore both
 * survive: the second neither reads a map the first has not updated yet, nor races it to the
 * server and gets overwritten by it. */
export function useToggleStar() {
    const queryClient = useQueryClient();
    return useMutation({
        scope: { id: 'starred-models' },
        onMutate: async ({ bucket, name }: { bucket: string; name: string }) => {
            // A refetch landing after this would put the old map back over the toggle.
            await queryClient.cancelQueries({ queryKey: libraryKeys.userData });
            const current = await queryClient.ensureQueryData({
                queryKey: libraryKeys.userData,
                queryFn: fetchMyUserData
            });
            queryClient.setQueryData<MyUserData>(libraryKeys.userData, {
                ...current,
                starred_models: toggledStars(current.starred_models ?? {}, bucket, name)
            });
        },
        mutationFn: async (_toggle: { bucket: string; name: string }) => {
            const current = queryClient.getQueryData<MyUserData>(libraryKeys.userData);
            if (!current) {
                throw new Error('User data is not loaded.');
            }
            // The map is the body itself: the route binds its JObject to the whole request.
            await api.post('SetStarredModels', { ...current.starred_models });
        },
        // Whatever the server now holds is the truth again.
        onError: () => queryClient.invalidateQueries({ queryKey: libraryKeys.userData })
    });
}

/** Everything a change to the model files makes stale: the browser listings, and the parameter
 *  schema the Generate pickers list models from (ListT2IParams). */
export function invalidateModelLists(queryClient: QueryClient): Promise<void> {
    return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['models'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.t2iParams }),
        queryClient.invalidateQueries({ queryKey: ['wildcard'] })
    ]).then(() => undefined);
}

/** Has the server rescan its model folders, then refetches everything listed from them. */
export async function refreshModelLists(queryClient: QueryClient): Promise<void> {
    await api.post('TriggerRefresh', { strong: true });
    await invalidateModelLists(queryClient);
}

/** Error raised by a bulk action that got part of the way: the messages of the entries that failed. */
function bulkError(failures: string[]): Error {
    return new Error(failures.join('\n'));
}

/** Deletes model files or wildcards, one request each - the API has no batch form. A failure does
 *  not stop the rest; the failures are reported together once all have been tried, and the lists
 *  are refetched once at the end rather than per file. */
export function useDeleteModels() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ subtype, names }: { subtype: string; names: string[] }) => {
            const failures: string[] = [];
            for (const name of names) {
                try {
                    if (subtype === 'Wildcards') {
                        await api.post('DeleteWildcard', { card: name });
                    }
                    else {
                        await api.post('DeleteModel', { modelName: name, subtype });
                    }
                }
                catch (error: unknown) {
                    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (failures.length > 0) {
                throw bulkError(failures);
            }
        },
        onSettled: () => invalidateModelLists(queryClient)
    });
}

/** A wildcard as DescribeModel answers: the full text, and the preview inline as a data URL. */
export interface WildcardDetail {
    name: string;
    raw: string;
    image: string | null;
}

export function fetchWildcard(name: string): Promise<WildcardDetail> {
    return api.post<WildcardDetail>('DescribeModel', { subtype: 'Wildcards', modelName: name });
}

/** One wildcard's whole text, which the listing only carries the first 512 characters of. */
export function useWildcard(name: string | null): UseQueryResult<WildcardDetail> {
    return useQuery({
        queryKey: libraryKeys.wildcard(name ?? ''),
        queryFn: () => fetchWildcard(name ?? ''),
        enabled: name !== null,
        staleTime: 30_000
    });
}

export interface SaveWildcard {
    /** Name the wildcard is saved as. */
    card: string;
    options: string;
    /** Image data URL, 'clear', or null to leave the preview as it is. */
    previewImage: string | null;
    /** The name it had before, when this is an edit that renames it. */
    previousName?: string;
}

/** Writes a wildcard, as legacy's saveEditWildcard (src/wwwroot/js/genpage/gentab/wildcards.js).
 *
 * There is no rename route for wildcards, so a changed name is a save under the new one followed by
 * a delete of the old, carrying the old preview across when no new one was given. */
export function useSaveWildcard() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (save: SaveWildcard) => {
            const renamed = save.previousName !== undefined && save.previousName !== '' && save.previousName !== save.card;
            let previewImage = save.previewImage;
            if (renamed && previewImage === null) {
                const old = await fetchWildcard(save.previousName ?? '');
                if (old.image && !isPlaceholderImage(old.image)) {
                    previewImage = old.image;
                }
            }
            await api.post('EditWildcard', {
                card: save.card,
                options: save.options.endsWith('\n') ? save.options : `${save.options}\n`,
                preview_image: previewImage ?? ''
            });
            if (renamed) {
                await api.post('DeleteWildcard', { card: save.previousName });
            }
        },
        onSettled: () => invalidateModelLists(queryClient)
    });
}

/** Renames a model file, or a wildcard (which has no rename route - see `useSaveWildcard`). */
export function useRenameModel() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ subtype, oldName, newName }: { subtype: string; oldName: string; newName: string }) => {
            if (subtype === 'Wildcards') {
                const old = await fetchWildcard(oldName);
                await api.post('EditWildcard', {
                    card: newName,
                    options: old.raw,
                    preview_image: old.image && !isPlaceholderImage(old.image) ? old.image : ''
                });
                await api.post('DeleteWildcard', { card: oldName });
                return;
            }
            await api.post('RenameModel', { oldName, newName, subtype });
            // As legacy's doRenameModelNow: the model sets are only rebuilt from disk by a refresh.
            await api.post('TriggerRefresh', { strong: true });
        },
        onSettled: () => invalidateModelLists(queryClient)
    });
}

/** What EditModelMetadata takes. Every field is written, so every field has to be sent - the
 *  server sets each one from the request unconditionally (ModelsAPI.cs EditModelMetadata). */
export interface ModelMetadataEdit {
    model: string;
    subtype: string;
    title: string;
    author: string;
    type: string;
    description: string;
    standard_width: number;
    standard_height: number;
    usage_hint: string;
    date: string;
    license: string;
    trigger_phrase: string;
    prediction_type: string;
    tags: string;
    is_negative_embedding: boolean;
    lora_default_weight: string;
    lora_default_confinement: string;
    /** Image data URL, 'clear', or null to leave the preview alone. */
    preview_image: string | null;
}

export function useEditModelMetadata() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (edit: ModelMetadataEdit) =>
            api.post('EditModelMetadata', { ...edit, preview_image: edit.preview_image ?? '' }),
        onSettled: () => invalidateModelLists(queryClient)
    });
}

/** Links one preset to a model, or unlinks it with an empty title.
 *
 * One preset per model, as legacy's edit dialog offers (ModelPresetLinkManager.setLink,
 * src/wwwroot/js/genpage/gentab/presets.js). SetPresetLinks replaces the whole map, so it is
 * read-modify-written like the star map. */
export function useSetPresetLink() {
    const queryClient = useQueryClient();
    return useMutation({
        scope: { id: 'preset-links' },
        mutationFn: async ({ subtype, model, preset }: { subtype: string; model: string; preset: string }) => {
            const current = await queryClient.ensureQueryData({
                queryKey: libraryKeys.userData,
                queryFn: fetchMyUserData
            });
            const name = cleanModelName(model);
            const links = { ...(current.model_preset_links ?? {}) };
            const forSubtype = { ...(links[subtype] ?? {}) };
            if (preset.trim()) {
                forSubtype[name] = [preset];
            }
            else {
                delete forSubtype[name];
            }
            links[subtype] = forSubtype;
            await api.post('SetPresetLinks', links);
            return links;
        },
        onSuccess: links =>
            queryClient.setQueryData<MyUserData>(libraryKeys.userData, old =>
                old ? { ...old, model_preset_links: links } : old
            )
    });
}

/** Loads a model onto backends. `backendId` null means all backends. */
export function useSelectModel() {
    return useMutation({
        mutationFn: ({ name }: { name: string }) => api.post('SelectModel', { model: name })
    });
}

/** Rewrites the file list of every cached ListImages listing in place.
 *
 * A listing is one flat array of a whole folder tree, every entry carrying its full generation
 * metadata - megabytes of JSON on a real output folder, and there is no route that returns less.
 * Refetching all of that to change one entry is a long wait on a slow connection, and a bulk
 * delete asked for one refetch per file. What changed is already known here, so it is applied to
 * the cached listings instead.
 *
 * `edit` is handed each entry with its path relative to the output root - what the image
 * mutations take, as against the folder-relative `src` a listing holds - and returns the entry to
 * keep in its place, or null to drop it. */
function editCachedImages(
    queryClient: QueryClient,
    edit: (entry: ImageEntry, full: string) => ImageEntry | null
): void {
    const cached = queryClient.getQueriesData<ListImagesResponse>({ queryKey: ['images'] });
    for (const [key, data] of cached) {
        if (!data) {
            continue;
        }
        // Second element of libraryKeys.images: the folder the listing was requested for.
        const folder = String(key[1] ?? '');
        const files: ImageEntry[] = [];
        let changed = false;
        for (const entry of data.files) {
            const next = edit(entry, folder ? `${folder}/${entry.src}` : entry.src);
            changed ||= next !== entry;
            if (next) {
                files.push(next);
            }
        }
        if (changed) {
            queryClient.setQueryData<ListImagesResponse>(key, { ...data, files });
        }
    }
}

/** The same entry with its metadata's star flag set. Metadata that will not parse is left alone -
 *  the flag lives inside it, so there is nowhere to record the change. */
function withStar(entry: ImageEntry, starred: boolean): ImageEntry {
    try {
        const metadata = JSON.parse(entry.metadata ?? '') as Record<string, unknown>;
        return { ...entry, metadata: JSON.stringify({ ...metadata, is_starred: starred }) };
    }
    catch {
        return entry;
    }
}

export function useToggleImageStar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ path }: { path: string }) =>
            api.post<{ new_state: boolean }>('ToggleImageStarred', { path }),
        onSuccess: (result, { path }) => {
            // Starring copies the file into `Starred/` and leaves the original where it is, so the
            // listing on hand stays true and only the flag on it has moved. Unstarring deletes or
            // moves that copy, which can invalidate the very path an entry was listed under, so
            // that one is settled by a real listing.
            if (result.new_state) {
                editCachedImages(queryClient, (entry, full) =>
                    full === path ? withStar(entry, true) : entry);
            }
            else {
                void queryClient.invalidateQueries({ queryKey: ['images'] });
            }
        },
        onError: () => queryClient.invalidateQueries({ queryKey: ['images'] })
    });
}

export function useDeleteImage() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ path }: { path: string }) => api.post('DeleteImage', { path }),
        onSuccess: (_result, { path }) =>
            editCachedImages(queryClient, (entry, full) => (full === path ? null : entry)),
        // A delete that failed left a file the listing has to account for again.
        onError: () => queryClient.invalidateQueries({ queryKey: ['images'] })
    });
}
