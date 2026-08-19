/** Server and user settings tree.
 *
 * Both ListServerSettings and GetUserSettings serialize through AutoConfigToParamData
 * (src/WebAPI/AdminAPI.cs:64), which emits a nested map where a node with type 'group' has
 * another map of the same shape as its `value`.
 */

export interface SettingNode {
    /** Lowercased data type, or 'group' for a section. */
    type: string;
    name: string;
    /** Scalar value, or a nested map when type is 'group'. Secrets come back as "\t<secret>". */
    value: unknown;
    description: string;
    values: string[] | null;
    value_names: string[] | null;
    is_secret: boolean;
    /** Absent on groups and on secrets. */
    default_value?: unknown;
}

export type SettingsTree = Record<string, SettingNode>;

/** Sentinel the server sends instead of a real secret value. Never send it back. */
export const SECRET_PLACEHOLDER = '\t<secret>';

export interface FlatSetting {
    /** Dotted path, eg 'Paths.ModelRoot' — the key ChangeServerSettings expects. */
    key: string;
    node: SettingNode;
    /** Dotted path of the owning group, or '' at the root. */
    groupKey: string;
    /** Display names of the owning groups, eg 'Paths › Model Roots'. Empty at the root. */
    groupPath: string;
}

export interface SettingsGroup {
    key: string;
    name: string;
    description: string;
    settings: FlatSetting[];
    children: SettingsGroup[];
}

/** Splits a settings tree into root-level settings plus a group tree, preserving server order. */
export function organizeSettings(tree: SettingsTree): {
    rootSettings: FlatSetting[];
    groups: SettingsGroup[];
    all: FlatSetting[];
} {
    const all: FlatSetting[] = [];

    function walk(
        node: SettingsTree,
        prefix: string,
        path: string
    ): { settings: FlatSetting[]; groups: SettingsGroup[] } {
        const settings: FlatSetting[] = [];
        const groups: SettingsGroup[] = [];
        for (const [key, entry] of Object.entries(node)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (entry.type === 'group') {
                const inner = walk(
                    (entry.value ?? {}) as SettingsTree,
                    fullKey,
                    path ? `${path} › ${entry.name}` : entry.name
                );
                groups.push({
                    key: fullKey,
                    name: entry.name,
                    description: entry.description,
                    settings: inner.settings,
                    children: inner.groups
                });
            }
            else {
                const flat: FlatSetting = { key: fullKey, node: entry, groupKey: prefix, groupPath: path };
                settings.push(flat);
                all.push(flat);
            }
        }
        return { settings, groups };
    }

    const result = walk(tree, '', '');
    return { rootSettings: result.settings, groups: result.groups, all };
}

/** True when the value differs from the server's stated default. */
export function isChangedFromDefault(node: SettingNode, value: unknown): boolean {
    if (node.is_secret || node.default_value === undefined) {
        return false;
    }
    return String(value) !== String(node.default_value);
}
