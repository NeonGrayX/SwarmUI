/** Backend list and settings schema.
 *
 * Two calls describe a backend between them:
 *   - ListBackendTypes gives the *schema* per type (src/Backends/BackendHandler.cs:242), one flat
 *     list of fields with a lowercased type name.
 *   - ListBackends gives the *values* (src/WebAPI/BackendAPI.cs:53), serialized through
 *     SaveAllWithoutSecretValues so secrets arrive as a sentinel rather than the real value.
 */

import { hasTranslation, t } from '@/i18n';

/** What the server sends in place of a secret, and what it accepts back to mean "leave it alone"
 *  (BackendHandler.EditById calls ExcludeSecretValuesThatMatch with exactly this string). */
export const SECRET_SENTINEL = '\t<secret>';

export interface BackendSettingSchema {
    name: string;
    /** 'text' | 'integer' | 'decimal' | 'boolean' | 'dropdown' | 'list' | 'group'. */
    type: string;
    description: string;
    placeholder: string;
    is_secret: boolean;
    /** Dropdown options; null for every other type. */
    values: string[] | null;
    value_names: string[] | null;
}

export interface BackendType {
    id: string;
    name: string;
    description: string;
    settings: BackendSettingSchema[];
    /** False marks a backend type that is not meant to be added casually. */
    is_standard: boolean;
}

export interface Backend {
    type: string;
    status: string;
    id: number;
    settings: Record<string, unknown>;
    /** Bumped by EditBackend, so a poller can tell an out-of-band edit from its own. */
    modcount: number;
    features: string[];
    enabled: boolean;
    title: string;
    max_usages: number;
    seconds_since_used: number;
    time_since_used: string;
    can_load_models?: boolean;
    current_model?: string;
}

/** Display name for a backend status. The six known states have identifiers; anything an
 *  extension reports falls back to the raw value, which is already a readable word. */
export function statusLabel(status: string): string {
    const key = `backends.status.${status}`;
    return hasTranslation(key) ? t(key) : status;
}

/** Backend status maps onto the --backend-* theme variables the legacy CSS already defines. */
export const STATUS_COLOR: Record<string, string> = {
    running: 'var(--backend-running)',
    idle: 'var(--backend-idle)',
    loading: 'var(--backend-loading)',
    waiting: 'var(--backend-waiting)',
    disabled: 'var(--backend-disabled)',
    errored: 'var(--backend-errored)'
};

/** Whether the backend is switched on *and* actually up.
 *
 * `enabled` alone is not enough. AddNewBackend leaves IsEnabled true (src/Backends/AbstractBackend.cs:87)
 * while an unconfigured backend parks itself in DISABLED for want of a start script or address
 * (src/Backends/ComfyUISelfStartBackend.cs:391), so a freshly added backend reports enabled with a
 * 'disabled' status. Both the power button's colour and what it does on click follow this rather
 * than `enabled`, so the two never disagree. */
export function isLive(backend: Backend): boolean {
    return backend.enabled && backend.status !== 'disabled';
}

/** Restart only does something from these two states; the button is disabled elsewhere. */
export function canRestart(status: string): boolean {
    return status === 'errored' || status === 'running';
}

/** The log tracker name for a self-starting backend's process output.
 *
 * NetworkBackendUtils.DoSelfStart registers the tracker under `<TypeName>-<id>` while tagging it
 * with identifier `backend-<id>` (src/Backends/NetworkBackendUtils.cs:517). ListRecentLogMessages
 * is keyed by the *name*, so that is what the log viewer needs. */
export function backendLogName(types: { identifier: string; name: string }[], id: number): string | null {
    return types.find(t => t.identifier === `backend-${id}`)?.name ?? null;
}

/** True when a 'text' setting holds several lines rather than one value.
 *
 * ListBackendTypes has no marker for this: every string field is reported as 'text', so the
 * default is a single-line input. That is wrong for the OtherHeaders fields on SwarmSwarm,
 * SimpleRemoteLLM and AutoScaling, all of which the server parses with Split('\n') —
 * SwarmSwarmBackend.cs:118. A single-line box cannot express a two-header value at all.
 *
 * Detected rather than hardcoded, so a backend from an extension gets the same treatment. Both
 * signals are load-bearing: the description catches an empty field on first configuration, and the
 * stored value catches a field configured elsewhere (config file, or another Swarm build) whose
 * description we don't recognise. If the schema ever gains a real multiline flag, delete this. */
export function isMultilineText(schema: BackendSettingSchema, value: unknown): boolean {
    if (schema.type !== 'text' || schema.is_secret) {
        return false;
    }
    return /newline separated/i.test(schema.description) || String(value ?? '').includes('\n');
}

/** Coerces a form value into the type the settings schema declares.
 *
 * Values ride to the server as JSON and land in FDSSection.FromSimple, which keeps whatever JSON
 * type it is given. Sending "5" where an int is expected would store a string and break the
 * backend on reload, so the conversion has to happen here. */
export function coerceSetting(schema: BackendSettingSchema, raw: unknown): unknown {
    switch (schema.type) {
        case 'integer': {
            const n = parseInt(String(raw), 10);
            return Number.isFinite(n) ? n : 0;
        }
        case 'decimal': {
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        }
        case 'boolean':
            return raw === true || raw === 'true';
        default:
            return raw ?? '';
    }
}

/** Builds the settings payload for EditBackend from a draft.
 *
 * Unedited secrets keep the sentinel so the server leaves the stored value in place; anything the
 * schema does not describe (a 'group', or a field from a newer server build) is passed through
 * untouched rather than silently dropped. */
export function settingsPayload(
    schema: BackendSettingSchema[],
    original: Record<string, unknown>,
    draft: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...original };
    for (const field of schema) {
        if (field.type === 'group') {
            continue;
        }
        const value = field.name in draft ? draft[field.name] : original[field.name];
        out[field.name] = field.is_secret ? (value ?? SECRET_SENTINEL) : coerceSetting(field, value);
    }
    return out;
}
