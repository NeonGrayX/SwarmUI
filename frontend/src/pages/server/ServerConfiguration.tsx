import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { SettingsForm } from '@/components/settings/SettingsForm';
import type { SettingsTree } from '@/settings/types';

export function ServerConfigurationPage() {
    const queryClient = useQueryClient();
    const canEdit = usePermission('edit_server_settings');

    const settings = useQuery({
        queryKey: ['server-settings'],
        queryFn: () => api.post<{ settings: SettingsTree }>('ListServerSettings')
    });

    const save = useMutation({
        mutationFn: (changes: Record<string, unknown>) =>
            api.post('ChangeServerSettings', { settings: changes }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-settings'] })
    });

    if (settings.isPending) {
        return <p className="p-6 text-sm text-fg-soft">Loading server settings…</p>;
    }
    if (settings.isError || !settings.data) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {settings.error instanceof Error ? settings.error.message : 'Failed to load server settings.'}
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
