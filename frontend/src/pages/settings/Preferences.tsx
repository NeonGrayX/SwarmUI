import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { api } from '@/api/client';
import { queryKeys, useUserSettings } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { useTranslation } from '@/i18n';

export function PreferencesPage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const canEdit = usePermission('edit_user_settings');
    // The command palette deep-links a single setting here, eg /settings/preferences?focus=Theme.
    const { focus } = useSearch({ strict: false }) as { focus?: string };

    const settings = useUserSettings();

    const save = useMutation({
        mutationFn: (changes: Record<string, unknown>) =>
            api.post('ChangeUserSettings', { settings: changes }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.userSettings });
            queryClient.invalidateQueries({ queryKey: ['user-data'] });
        }
    });

    if (settings.isPending) {
        return <p className="p-6 text-sm text-fg-soft">{t('preferences.loading')}</p>;
    }
    if (settings.isError || !settings.data) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {settings.error instanceof Error ? settings.error.message : t('preferences.loadFailed')}
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
