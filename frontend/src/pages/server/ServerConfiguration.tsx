import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { api } from '@/api/client';
import { queryKeys, useServerSettings } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { useTranslation } from '@/i18n';

export function ServerConfigurationPage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const canEdit = usePermission('edit_server_settings');
    // The command palette deep-links a single setting here, eg /server/configuration?focus=Paths.ModelRoot.
    const { focus } = useSearch({ strict: false }) as { focus?: string };

    const settings = useServerSettings();

    const save = useMutation({
        mutationFn: (changes: Record<string, unknown>) =>
            api.post('ChangeServerSettings', { settings: changes }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.serverSettings })
    });

    if (settings.isPending) {
        return <p className="p-6 text-sm text-fg-soft">{t('serverConfig.loading')}</p>;
    }
    if (settings.isError || !settings.data) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {settings.error instanceof Error ? settings.error.message : t('serverConfig.loadFailed')}
            </p>
        );
    }

    return (
        <SettingsForm
            tree={settings.data.settings}
            focusKey={focus}
            readOnly={!canEdit}
            saving={save.isPending}
            onSave={async changes => {
                await save.mutateAsync(changes);
            }}
        />
    );
}
