/** The single source of truth for navigation.
 *
 * The rail, the router, the breadcrumbs and the command palette are all generated from this list.
 * Adding a screen means adding one entry here — nothing else needs to know about it.
 */

import {
    Boxes,
    FileText,
    Gauge,
    Image,
    Images,
    KeyRound,
    Layers,
    ListTree,
    Package,
    Palette,
    Puzzle,
    ScrollText,
    Server,
    Settings,
    Shapes,
    SlidersHorizontal,
    Sparkles,
    Type,
    Users,
    Wand2,
    Wrench,
    type LucideIcon
} from 'lucide-react';

import type { PermissionRequirement } from '@/api/permissions';

/** Top-level rail entries. */
export type SectionId = 'generate' | 'library' | 'tools' | 'server' | 'settings';

export interface Section {
    id: SectionId;
    /** Translation identifier for the display name. Resolve with `t(labelKey)`. */
    labelKey: string;
    icon: LucideIcon;
    /** Permission required to see the section at all. */
    permission?: PermissionRequirement;
}

export interface Destination {
    /** Stable id, also the route param within its section. */
    id: string;
    section: SectionId;
    /** Translation identifier for the display name. Resolve with `t(labelKey)`. */
    labelKey: string;
    icon: LucideIcon;
    /** Full route path, eg '/library/models'. */
    path: string;
    /** Permission required, matched against the session's permission list.
     *  An array means any one of them is enough. */
    permission?: PermissionRequirement;
    /** Extra search terms for the command palette (legacy names, synonyms).
     *  Kept in English: they are aliases people type, not text anyone reads. The palette also
     *  matches the translated label, so search works in the active language regardless. */
    keywords?: string[];
}

export const SECTIONS: Section[] = [
    { id: 'generate', labelKey: 'nav.section.generate', icon: Sparkles },
    { id: 'library', labelKey: 'nav.section.library', icon: Boxes },
    { id: 'tools', labelKey: 'nav.section.tools', icon: Wrench, permission: 'utilities_tab' },
    { id: 'server', labelKey: 'nav.section.server', icon: Server, permission: 'view_server_tab' },
    { id: 'settings', labelKey: 'nav.section.settings', icon: Settings, permission: 'user_tab' }
];

export const DESTINATIONS: Destination[] = [
    // --- Generate ------------------------------------------------------------------------------
    {
        id: 'workspace',
        section: 'generate',
        labelKey: 'nav.destination.workspace',
        icon: Wand2,
        path: '/generate',
        keywords: ['text2image', 't2i', 'prompt', 'create', 'txt2img']
    },

    // --- Library --------------------------------------------------------------------------------
    {
        id: 'history',
        section: 'library',
        labelKey: 'nav.destination.history',
        icon: Images,
        path: '/library/history',
        keywords: ['outputs', 'gallery', 'previous', 'generated']
    },
    {
        id: 'models',
        section: 'library',
        labelKey: 'nav.destination.models',
        icon: Package,
        path: '/library/models',
        keywords: ['checkpoint', 'sd', 'stable diffusion', 'safetensors']
    },
    {
        id: 'loras',
        section: 'library',
        labelKey: 'nav.destination.loras',
        icon: Layers,
        path: '/library/loras',
        keywords: ['lora', 'lycoris', 'adapter']
    },
    {
        id: 'vaes',
        section: 'library',
        labelKey: 'nav.destination.vaes',
        icon: Shapes,
        path: '/library/vaes',
        keywords: ['vae', 'autoencoder']
    },
    {
        id: 'embeddings',
        section: 'library',
        labelKey: 'nav.destination.embeddings',
        icon: Type,
        path: '/library/embeddings',
        keywords: ['textual inversion', 'ti', 'embedding']
    },
    {
        id: 'controlnets',
        section: 'library',
        labelKey: 'nav.destination.controlnets',
        icon: ListTree,
        path: '/library/controlnets',
        keywords: ['controlnet', 'control net', 'guidance']
    },
    {
        id: 'wildcards',
        section: 'library',
        labelKey: 'nav.destination.wildcards',
        icon: Shapes,
        path: '/library/wildcards',
        keywords: ['wildcard', 'random', 'dynamic prompt']
    },
    {
        id: 'presets',
        section: 'library',
        labelKey: 'nav.destination.presets',
        icon: Palette,
        path: '/library/presets',
        keywords: ['preset', 'saved settings', 'style']
    },

    // --- Tools ----------------------------------------------------------------------------------
    {
        id: 'tokenizer',
        section: 'tools',
        labelKey: 'nav.destination.tokenizer',
        icon: Type,
        path: '/tools/tokenizer',
        permission: 'use_tokenizer',
        keywords: ['token', 'clip', 'count', 'tokenize']
    },
    {
        id: 'downloader',
        section: 'tools',
        labelKey: 'nav.destination.downloader',
        icon: Package,
        path: '/tools/downloader',
        permission: 'download_models',
        keywords: ['download', 'civitai', 'huggingface', 'fetch model']
    },
    {
        id: 'pickle2safetensors',
        section: 'tools',
        labelKey: 'nav.destination.pickle2safetensors',
        icon: Package,
        path: '/tools/pickle-to-safetensors',
        permission: 'pickle2safetensors',
        keywords: ['pickle', 'ckpt', 'safetensors', 'convert']
    },
    {
        id: 'lora-extractor',
        section: 'tools',
        labelKey: 'nav.destination.lora-extractor',
        icon: Layers,
        path: '/tools/lora-extractor',
        permission: 'extra_loras',
        keywords: ['extract', 'lora', 'distill']
    },
    {
        id: 'metadata',
        section: 'tools',
        labelKey: 'nav.destination.metadata',
        icon: FileText,
        path: '/tools/metadata',
        permission: 'reset_metadata',
        keywords: ['metadata', 'reset', 'civitai scan', 'rebuild']
    },

    // --- Server ---------------------------------------------------------------------------------
    {
        id: 'info',
        section: 'server',
        labelKey: 'nav.destination.info',
        icon: Gauge,
        path: '/server/info',
        permission: 'read_server_info_panels',
        keywords: ['status', 'resources', 'gpu', 'vram', 'usage']
    },
    {
        id: 'backends',
        section: 'server',
        labelKey: 'nav.destination.backends',
        icon: Server,
        path: '/server/backends',
        permission: 'view_backends_list',
        keywords: ['comfy', 'comfyui', 'gpu', 'backend', 'worker']
    },
    {
        id: 'configuration',
        section: 'server',
        labelKey: 'nav.destination.configuration',
        icon: SlidersHorizontal,
        path: '/server/configuration',
        permission: 'read_server_settings',
        keywords: ['settings', 'config', 'paths', 'network']
    },
    {
        id: 'users',
        section: 'server',
        labelKey: 'nav.destination.users',
        icon: Users,
        path: '/server/users',
        permission: ['manage_users', 'configure_roles'],
        keywords: ['accounts', 'roles', 'permissions', 'login']
    },
    {
        id: 'extensions',
        section: 'server',
        labelKey: 'nav.destination.extensions',
        icon: Puzzle,
        path: '/server/extensions',
        permission: 'manage_extensions',
        keywords: ['plugin', 'addon', 'install extension']
    },
    {
        id: 'logs',
        section: 'server',
        labelKey: 'nav.destination.logs',
        icon: ScrollText,
        path: '/server/logs',
        permission: 'view_logs',
        keywords: ['log', 'debug', 'error', 'console', 'output']
    },

    // --- Settings -------------------------------------------------------------------------------
    {
        id: 'account',
        section: 'settings',
        labelKey: 'nav.destination.account',
        icon: KeyRound,
        path: '/settings/account',
        keywords: ['user info', 'password', 'api key', 'auth token', 'profile']
    },
    {
        id: 'preferences',
        section: 'settings',
        labelKey: 'nav.destination.preferences',
        icon: SlidersHorizontal,
        path: '/settings/preferences',
        permission: 'read_user_settings',
        keywords: ['user settings', 'theme', 'language', 'file format']
    },
    {
        id: 'parameters',
        section: 'settings',
        labelKey: 'nav.destination.parameters',
        icon: ListTree,
        path: '/settings/parameters',
        permission: 'edit_params',
        keywords: ['param config', 'ordering', 'visibility', 'advanced']
    },
    {
        id: 'appearance',
        section: 'settings',
        labelKey: 'nav.destination.appearance',
        icon: Image,
        path: '/settings/appearance',
        keywords: ['theme', 'layout', 'density', 'dark', 'light']
    }
];

/** Destinations belonging to a section, in declaration order. */
export function destinationsIn(section: SectionId): Destination[] {
    return DESTINATIONS.filter(d => d.section === section);
}

/** The landing destination for a rail section. */
export function defaultDestination(section: SectionId): Destination | undefined {
    return DESTINATIONS.find(d => d.section === section);
}

export function findSection(id: SectionId): Section | undefined {
    return SECTIONS.find(s => s.id === id);
}

export function findDestinationByPath(path: string): Destination | undefined {
    return DESTINATIONS.find(d => d.path === path);
}
