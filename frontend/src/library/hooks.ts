/** Data access for the Library browsers. */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/api/client';
import type {
    ListImagesResponse,
    ListModelsResponse,
    ModelSubtype,
    MyUserData,
    SortMode
} from './types';

export const libraryKeys = {
    models: (subtype: string, path: string, sort: SortMode, reverse: boolean, depth: number) =>
        ['models', subtype, path, sort, reverse, depth] as const,
    images: (path: string, sort: string, reverse: boolean, depth: number) =>
        ['images', path, sort, reverse, depth] as const,
    userData: ['user-data'] as const
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

export function useImages(
    path: string,
    sort: 'Name' | 'Date',
    reverse: boolean,
    depth: number
): UseQueryResult<ListImagesResponse> {
    return useQuery({
        queryKey: libraryKeys.images(path, sort, reverse, depth),
        queryFn: () =>
            api.post<ListImagesResponse>('ListImages', { path, depth, sortBy: sort, sortReverse: reverse }),
        staleTime: 30_000
    });
}

export function useMyUserData(enabled = true): UseQueryResult<MyUserData> {
    return useQuery({
        queryKey: libraryKeys.userData,
        queryFn: () => api.post<MyUserData>('GetMyUserData'),
        staleTime: 60_000,
        enabled
    });
}

/** Toggles a model's starred state.
 *  SetStarredModels replaces the whole map, so we read-modify-write the cached copy. */
export function useToggleStar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ subtype, name }: { subtype: string; name: string }) => {
            const current = queryClient.getQueryData<MyUserData>(libraryKeys.userData);
            const starred = { ...(current?.starred_models ?? {}) };
            const list = starred[subtype] ?? [];
            starred[subtype] = list.includes(name) ? list.filter(n => n !== name) : [...list, name];
            await api.post('SetStarredModels', { raw: starred });
            return starred;
        },
        onSuccess: starred => {
            queryClient.setQueryData<MyUserData>(libraryKeys.userData, old =>
                old ? { ...old, starred_models: starred } : old
            );
        }
    });
}

export function useDeleteModel() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ subtype, name }: { subtype: string; name: string }) =>
            api.post('DeleteModel', { modelName: name, subtype }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] })
    });
}

export function useRenameModel() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ subtype, oldName, newName }: { subtype: string; oldName: string; newName: string }) =>
            api.post('RenameModel', { oldName, newName, subtype }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] })
    });
}

/** Loads a model onto backends. `backendId` null means all backends. */
export function useSelectModel() {
    return useMutation({
        mutationFn: ({ name }: { name: string }) => api.post('SelectModel', { model: name })
    });
}

export function useToggleImageStar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ path }: { path: string }) => api.post('ToggleImageStarred', { path }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['images'] })
    });
}

export function useDeleteImage() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ path }: { path: string }) => api.post('DeleteImage', { path }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['images'] })
    });
}
