import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { api } from '@/api/client';
import { queryKeys, useT2IParams, useUserSettings } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { useTranslation } from '@/i18n';
import type { SettingsTree } from '@/settings/types';

/** The server lists only "None" for the default-VAE settings (Settings.cs, VAEsData), leaving the
 *  client to fill in the real VAE list - as the legacy editor does (settings_editor.js
 *  loadUserSettings). Returns the tree unchanged when there is nothing to fill. */
function withVaeChoices(tree: SettingsTree, vaes: string[] | undefined): SettingsTree {
    const groupKey = Object.keys(tree).find(key => key.toLowerCase() === 'vaes');
    const group = groupKey ? tree[groupKey] : undefined;
    if (!vaes || !groupKey || !group || group.type !== 'group') {
        return tree;
    }
    const inner = { ...(group.value as SettingsTree) };
    for (const [key, node] of Object.entries(inner)) {
        const lower = key.toLowerCase();
        if (lower.startsWith('default') && lower.endsWith('vae')) {
            // Keep a saved choice selectable even if that VAE has since gone missing.
            const current = String(node.value ?? '');
            const values = ['None', ...vaes];
            if (current && !values.includes(current)) {
                values.push(current);
            }
            inner[key] = { ...node, values, value_names: null };
        }
    }
    return { ...tree, [groupKey]: { ...group, value: inner } };
}

export function PreferencesPage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const canEdit = usePermission('edit_user_settings');
    // The command palette deep-links a single setting here, eg /settings/preferences?focus=Theme.
    const { focus } = useSearch({ strict: false }) as { focus?: string };

    const settings = useUserSettings();
    const params = useT2IParams();
    const vaeNames = useMemo(() => params.data?.models.VAE?.map(entry => entry[0]), [params.data]);
    const tree = useMemo(
        () => (settings.data ? withVaeChoices(settings.data.settings, vaeNames) : null),
        [settings.data, vaeNames]
    );

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
    if (settings.isError || !tree) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {settings.error instanceof Error ? settings.error.message : t('preferences.loadFailed')}
            </p>
        );
    }

    return (
        <SettingsForm
            tree={tree}
            focusKey={focus}
            readOnly={!canEdit}
            saving={save.isPending}
            onSave={async changes => {
                await save.mutateAsync(changes);
            }}
        />
    );
}
