import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { SettingsForm } from '@/components/settings/SettingsForm';
import type { SettingsTree } from '@/settings/types';

export function PreferencesPage() {
    const queryClient = useQueryClient();
    const canEdit = usePermission('edit_user_settings');

    const settings = useQuery({
        queryKey: ['user-settings'],
        queryFn: () => api.post<{ settings: SettingsTree }>('GetUserSettings')
    });

    const save = useMutation({
        mutationFn: (changes: Record<string, unknown>) =>
            api.post('ChangeUserSettings', { settings: changes }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-settings'] });
            queryClient.invalidateQueries({ queryKey: ['user-data'] });
        }
    });

    if (settings.isPending) {
        return <p className="p-6 text-sm text-fg-soft">Loading preferences…</p>;
    }
    if (settings.isError || !settings.data) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {settings.error instanceof Error ? settings.error.message : 'Failed to load preferences.'}
            </p>
        );
    }

    return (
        <SettingsForm
            tree={settings.data.settings}
            readOnly={!canEdit}
            saving={save.isPending}
            onSave={async changes => {
                await save.mutateAsync(changes);
            }}
        />
    );
}
