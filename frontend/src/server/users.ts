/** Accounts, roles and permissions.
 *
 * Four admin routes describe the model between them (all in src/WebAPI/AdminAPI.cs):
 *   - AdminListUsers  -> the account ids, nothing more.
 *   - AdminGetUserInfo -> per-account detail plus the account's full settings tree.
 *   - AdminListRoles  -> the roles, each carrying its own limits and its permission id list.
 *   - AdminListPermissions -> the permission catalog, plus `ordered` which groups the ids by
 *     permission group (Permissions.FixOrdered, src/Accounts/Permissions.cs:29). Rendering by
 *     `ordered` rather than by object key order is what keeps groups contiguous.
 *
 * A user has roles; a role has permissions. Nothing grants a permission to a user directly, so
 * editing a user's access means either editing their role list or editing a role.
 */

import { t } from '@/i18n';
import type { SettingsTree } from '@/settings/types';

export interface RoleInfo {
    name: string;
    description: string;
    max_outpath_depth: number;
    /** Core roles (owner/admin/poweruser/user/guest) — cannot be deleted. */
    is_auto_generated: boolean;
    model_whitelist: string[];
    model_blacklist: string[];
    permissions: string[];
    max_t2i_simultaneous: number;
    allow_unsafe_outpaths: boolean;
}

export interface PermissionInfo {
    name: string;
    description: string;
    /** PermissionDefault name: NOBODY | ADMINS | POWERUSERS | USER | GUEST. */
    default: string;
    group: { name: string; description: string };
    /** PermSafetyLevel name: POWERFUL | RISKY | UNTESTED | SAFE. */
    safety_level: string;
    alt_safety_text: string | null;
}

export interface UserInfo {
    user_id: string;
    /** True when an admin last set the password, so the user is asked to change it on login. */
    password_set_by_admin: boolean;
    settings: SettingsTree;
    oauth_email: string;
    /** Effective simultaneous-generation cap, after combining roles and available backends. */
    max_t2i: number;
}

/** The magic role permission that stands in for every other one (src/Accounts/User.cs:345). */
export const WILDCARD_PERMISSION = '*';

/** The settings key holding a user's role ids. Edited through a dedicated control rather than the
 *  generic settings form, so it is hidden from the tree the form is handed. */
export const ROLES_SETTING_KEY = 'Roles';

/** How the settings tree serializes a List<string> (AdminAPI.AutoConfigToParamData). */
export const LIST_SEPARATOR = ' || ';

/** Display name for a PermissionDefault, or the raw enum name when it is one we don't know. */
export function permissionDefaultLabel(value: string): string {
    return PERMISSION_DEFAULTS.has(value) ? t(`permissions.default.${value}`) : value;
}

const PERMISSION_DEFAULTS = new Set(['NOBODY', 'ADMINS', 'POWERUSERS', 'USER', 'GUEST']);

/** Safety levels, worst first — how much trust a permission demands of whoever holds it.
 *  `danger` is presentation only; the label and note are looked up per language. */
const SAFETY_DANGER: Record<string, boolean> = {
    POWERFUL: true,
    RISKY: true,
    UNTESTED: false,
    SAFE: false
};

export interface SafetyLevel {
    label: string;
    note: string;
    danger: boolean;
}

/** Safety level presentation for a PermSafetyLevel name, or null when it is one we don't know. */
export function safetyLevel(level: string): SafetyLevel | null {
    if (!(level in SAFETY_DANGER)) {
        return null;
    }
    return {
        label: t(`permissions.safety.${level}.label`),
        note: t(`permissions.safety.${level}.note`),
        danger: SAFETY_DANGER[level]
    };
}

/** The editable half of a role, as the form holds it. Mirrors the arguments AdminEditRole takes. */
export interface RoleDraft {
    description: string;
    max_outpath_depth: number;
    max_t2i_simultaneous: number;
    allow_unsafe_outpaths: boolean;
    model_whitelist: string;
    model_blacklist: string;
    permissions: string[];
}

export function draftFromRole(role: RoleInfo): RoleDraft {
    return {
        description: role.description,
        max_outpath_depth: role.max_outpath_depth,
        max_t2i_simultaneous: role.max_t2i_simultaneous,
        allow_unsafe_outpaths: role.allow_unsafe_outpaths,
        model_whitelist: role.model_whitelist.join(', '),
        model_blacklist: role.model_blacklist.join(', '),
        permissions: [...role.permissions]
    };
}

/** AdminEditRole takes every field on every call and the lists as comma-separated strings. */
export function roleEditBody(name: string, draft: RoleDraft): Record<string, unknown> {
    return {
        name,
        description: draft.description,
        max_outpath_depth: draft.max_outpath_depth,
        max_t2i_simultaneous: draft.max_t2i_simultaneous,
        allow_unsafe_outpaths: draft.allow_unsafe_outpaths,
        model_whitelist: draft.model_whitelist,
        model_blacklist: draft.model_blacklist,
        permissions: draft.permissions.join(',')
    };
}

/** Which fields of a draft differ from the saved role, for the unsaved-changes bar. */
export function countRoleEdits(role: RoleInfo, draft: RoleDraft): number {
    const saved = draftFromRole(role);
    let count = 0;
    for (const key of ['description', 'max_outpath_depth', 'max_t2i_simultaneous', 'allow_unsafe_outpaths', 'model_whitelist', 'model_blacklist'] as const) {
        if (String(saved[key]) !== String(draft[key])) {
            count++;
        }
    }
    const before = new Set(saved.permissions);
    const after = new Set(draft.permissions);
    for (const perm of new Set([...before, ...after])) {
        if (before.has(perm) !== after.has(perm)) {
            count++;
        }
    }
    return count;
}

/** Groups permission ids by their group, keeping the server's ordering within and between groups. */
export function groupPermissions(
    ordered: string[],
    info: Record<string, PermissionInfo>
): { name: string; description: string; ids: string[] }[] {
    const groups: { name: string; description: string; ids: string[] }[] = [];
    for (const id of ordered) {
        const perm = info[id];
        if (!perm) {
            continue;
        }
        let group = groups.at(-1);
        if (!group || group.name !== perm.group.name) {
            group = { name: perm.group.name, description: perm.group.description, ids: [] };
            groups.push(group);
        }
        group.ids.push(id);
    }
    return groups;
}

/** Reads a user's role ids out of their settings tree. Stored as a List<string>, so it arrives
 *  joined by LIST_SEPARATOR (or as a real array once we have edited it locally). */
export function rolesFromSettings(settings: SettingsTree): string[] {
    const value = settings[ROLES_SETTING_KEY]?.value;
    if (Array.isArray(value)) {
        return value.map(String);
    }
    return String(value ?? '')
        .split(LIST_SEPARATOR)
        .map(s => s.trim())
        .filter(Boolean);
}

/** The settings tree minus the role list, which gets its own editor above the form. */
export function settingsWithoutRoles(settings: SettingsTree): SettingsTree {
    const { [ROLES_SETTING_KEY]: _roles, ...rest } = settings;
    return rest;
}
