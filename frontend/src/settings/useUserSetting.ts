/** One user setting's value, for the places that behave differently depending on it. */

import { useSession, useUserSettings } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import type { SettingsTree } from './types';

/** Reads a setting by dotted path, eg `ui.interpretedpromptontop`, or undefined if absent.
 *
 * The tree is keyed by the lowercased field name (AutoConfigToParamData, src/WebAPI/AdminAPI.cs);
 * the C# spelling survives only as each node's `name`. So the path is lowercased before lookup,
 * and either spelling finds the same setting. */
function settingValue(tree: SettingsTree | undefined, path: string): unknown {
    let level: SettingsTree | undefined = tree;
    const parts = path.toLowerCase().split('.');
    for (let i = 0; i < parts.length; i++) {
        const node = level?.[parts[i]];
        if (!node) {
            return undefined;
        }
        if (i === parts.length - 1) {
            return node.value;
        }
        level = node.type === 'group' ? (node.value as SettingsTree) : undefined;
    }
    return undefined;
}

/** A user setting, or `fallback` until the settings arrive, when they fail to, or when the account
 *  may not read its own settings. The fallback should be the setting's server default, so an
 *  account without the permission behaves as a fresh one would. */
export function useUserSetting<T>(path: string, fallback: T): T {
    const session = useSession();
    const canRead = usePermission('read_user_settings');
    const settings = useUserSettings(session.isSuccess && canRead);
    const value = settingValue(settings.data?.settings, path);
    return value === undefined || value === null ? fallback : (value as T);
}
