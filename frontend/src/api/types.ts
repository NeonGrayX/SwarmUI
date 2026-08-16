/** Shapes returned by the Swarm HTTP API.
 *
 * These mirror the C# serializers directly — keep them in sync with:
 *   - GetNewSession:  src/WebAPI/BasicAPIFeatures.cs
 *   - ListT2IParams:  src/WebAPI/T2IAPI.cs, serialized by T2IParamType.ToNet / T2IParamGroup.ToNet
 *                     in src/Text2Image/T2IParamTypes.cs
 */

/** Error envelope. Any API response may carry these instead of its normal payload. */
export interface ApiError {
    error?: string;
    /** Machine-readable id, eg 'invalid_session_id', 'bad_impersonate', 'basic_api'. */
    error_id?: string;
}

/** Response of the `GetNewSession` call. */
export interface SessionData {
    session_id: string;
    user_id: string;
    output_append_user: boolean;
    /** Server VaryID — changes when the server restarts/updates. */
    version: string;
    server_id: string;
    permissions: string[];
}

/** How a parameter should be presented. Mirrors ParamViewType (T2IParamTypes.cs:50). */
export type ParamViewType =
    | 'normal'
    | 'prompt'
    | 'small'
    | 'big'
    | 'slider'
    | 'pot_slider'
    | 'seed'
    | 'video_frames';

/** Underlying data type of a parameter. Mirrors T2IParamDataType (T2IParamTypes.cs:17). */
export type ParamDataType =
    | 'unset'
    | 'text'
    | 'integer'
    | 'decimal'
    | 'boolean'
    | 'dropdown'
    | 'image'
    | 'model'
    | 'list'
    | 'image_list'
    | 'audio'
    | 'audio_list'
    | 'video'
    | 'video_list';

/** One generation parameter. Serialized by T2IParamType.ToNet (T2IParamTypes.cs:119). */
export interface ParamSchema {
    name: string;
    id: string;
    description: string;
    type: ParamDataType;
    subtype: string | null;
    default: string | null;
    min: number;
    max: number;
    view_min: number;
    view_max: number;
    step: number;
    /** Allowed values for dropdown-style params, or null for free input. */
    values: string[] | null;
    /** Display names parallel to `values`. */
    value_names: string[] | null;
    examples: string[] | null;
    visible: boolean;
    advanced: boolean;
    feature_flag: string | null;
    /** If true, the param has an on/off switch of its own. */
    toggleable: boolean;
    priority: number;
    /** Id of the owning group, or null for ungrouped. */
    group: string | null;
    always_retain: boolean;
    do_not_save: boolean;
    do_not_preview: boolean;
    view_type: ParamViewType;
    extra_hidden: boolean;
    can_sectionalize: boolean;
    nonreusable: boolean;
    depend_non_default: string | null;
}

/** A parameter group. Serialized by T2IParamGroup.ToNet (T2IParamTypes.cs:202).
 *  Groups nest via `parent`. */
export interface ParamGroupSchema {
    name: string;
    id: string;
    /** If true the whole group has a master on/off toggle. */
    toggles: boolean;
    /** Whether the group starts expanded. */
    open: boolean;
    priority: number;
    description: string;
    advanced: boolean;
    can_shrink: boolean;
    parent: string | null;
}

/** Backend health summary, as computed by Program.Backends.CurrentBackendStatus. */
export interface BackendStatus {
    /** '' when healthy, otherwise 'warn' or 'error'. */
    class: string;
    message: string;
    any_loading: boolean;
}

/** Per-session generation counters. */
export interface SessionStats {
    waiting_gens: number;
    loading_models: number;
    waiting_backends: number;
    live_gens: number;
}

/** Response of the `GetCurrentStatus` call (src/WebAPI/BasicAPIFeatures.cs). */
export interface CurrentStatus {
    status: SessionStats;
    backend_status: BackendStatus;
    /** Feature flags the connected backends support; gates `feature_flag` params. */
    supported_features: string[];
}

/** One entry of the per-type model lists: `[modelName, modelClassId]`. */
export type ModelListEntry = [name: string, modelClass: string | null];

/** Response of the `ListT2IParams` call (src/WebAPI/T2IAPI.cs). */
export interface ListT2IParamsResponse {
    list: ParamSchema[];
    /** Ordered by group priority; nest them using each group's `parent`. */
    groups: ParamGroupSchema[];
    /** Keyed by model type, eg 'Stable-Diffusion', 'LoRA', 'VAE'. */
    models: Record<string, ModelListEntry[]>;
    model_compat_classes: Record<string, unknown>;
    model_classes: Record<string, unknown>;
    wildcards: string[];
    /** User's saved overrides of param metadata, or null if none set. */
    param_edits: Record<string, unknown> | null;
}
