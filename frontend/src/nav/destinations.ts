/** The single source of truth for navigation.
 *
 * The rail, the router, the breadcrumbs and the command palette are all generated from this list.
 * Adding a screen means adding one entry here — nothing else needs to know about it.
 *
 * This replaces the legacy UI's three independent nested `nav-tabs` strips (#toptablist,
 * #utilitiestablist / #usertablist / #servertablist, and #bottombartabcollection), which had to be
 * kept in sync by hand across Text2Image.cshtml and the _Generate partials.
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
    label: string;
    icon: LucideIcon;
    /** Permission required to see the section at all. */
    permission?: PermissionRequirement;
}

export interface Destination {
    /** Stable id, also the route param within its section. */
    id: string;
    section: SectionId;
    label: string;
    icon: LucideIcon;
    /** Full route path, eg '/library/models'. */
    path: string;
    /** Permission required, matched against the session's permission list.
     *  An array means any one of them is enough. */
    permission?: PermissionRequirement;
    /** Extra search terms for the command palette (legacy names, synonyms). */
    keywords?: string[];
    /** Set until the screen is actually implemented, so placeholders are honest. */
    placeholder?: boolean;
}

export const SECTIONS: Section[] = [
    { id: 'generate', label: 'Generate', icon: Sparkles },
    { id: 'library', label: 'Library', icon: Boxes },
    { id: 'tools', label: 'Tools', icon: Wrench, permission: 'utilities_tab' },
    { id: 'server', label: 'Server', icon: Server, permission: 'view_server_tab' },
    { id: 'settings', label: 'Settings', icon: Settings, permission: 'user_tab' }
];

export const DESTINATIONS: Destination[] = [
    // --- Generate ------------------------------------------------------------------------------
    {
        id: 'workspace',
        section: 'generate',
        label: 'Workspace',
        icon: Wand2,
        path: '/generate',
        keywords: ['text2image', 't2i', 'prompt', 'create', 'txt2img'],
        placeholder: true
    },

    // --- Library (was the #bottombartabcollection strip) ----------------------------------------
    {
        id: 'history',
        section: 'library',
        label: 'History',
        icon: Images,
        path: '/library/history',
        keywords: ['outputs', 'gallery', 'previous', 'generated'],
        placeholder: true
    },
    {
        id: 'models',
        section: 'library',
        label: 'Models',
        icon: Package,
        path: '/library/models',
        keywords: ['checkpoint', 'sd', 'stable diffusion', 'safetensors'],
        placeholder: true
    },
    {
        id: 'loras',
        section: 'library',
        label: 'LoRAs',
        icon: Layers,
        path: '/library/loras',
        keywords: ['lora', 'lycoris', 'adapter'],
        placeholder: true
    },
    {
        id: 'vaes',
        section: 'library',
        label: 'VAEs',
        icon: Shapes,
        path: '/library/vaes',
        keywords: ['vae', 'autoencoder'],
        placeholder: true
    },
    {
        id: 'embeddings',
        section: 'library',
        label: 'Embeddings',
        icon: Type,
        path: '/library/embeddings',
        keywords: ['textual inversion', 'ti', 'embedding'],
        placeholder: true
    },
    {
        id: 'controlnets',
        section: 'library',
        label: 'ControlNets',
        icon: ListTree,
        path: '/library/controlnets',
        keywords: ['controlnet', 'control net', 'guidance'],
        placeholder: true
    },
    {
        id: 'wildcards',
        section: 'library',
        label: 'Wildcards',
        icon: Shapes,
        path: '/library/wildcards',
        keywords: ['wildcard', 'random', 'dynamic prompt'],
        placeholder: true
    },
    {
        id: 'presets',
        section: 'library',
        label: 'Presets',
        icon: Palette,
        path: '/library/presets',
        keywords: ['preset', 'saved settings', 'style'],
        placeholder: true
    },

    // --- Tools (was the Utilities tab) ----------------------------------------------------------
    {
        id: 'tokenizer',
        section: 'tools',
        label: 'CLIP Tokenization',
        icon: Type,
        path: '/tools/tokenizer',
        permission: 'use_tokenizer',
        keywords: ['token', 'clip', 'count', 'tokenize'],
        placeholder: true
    },
    {
        id: 'downloader',
        section: 'tools',
        label: 'Model Downloader',
        icon: Package,
        path: '/tools/downloader',
        permission: 'download_models',
        keywords: ['download', 'civitai', 'huggingface', 'fetch model'],
        placeholder: true
    },
    {
        id: 'pickle2safetensors',
        section: 'tools',
        label: 'Pickle To Safetensors',
        icon: Package,
        path: '/tools/pickle-to-safetensors',
        permission: 'pickle2safetensors',
        keywords: ['pickle', 'ckpt', 'safetensors', 'convert'],
        placeholder: true
    },
    {
        id: 'lora-extractor',
        section: 'tools',
        label: 'LoRA Extractor',
        icon: Layers,
        path: '/tools/lora-extractor',
        permission: 'extra_loras',
        keywords: ['extract', 'lora', 'distill'],
        placeholder: true
    },
    {
        id: 'metadata',
        section: 'tools',
        label: 'Metadata Utilities',
        icon: FileText,
        path: '/tools/metadata',
        permission: 'reset_metadata',
        keywords: ['metadata', 'reset', 'civitai scan', 'rebuild'],
        placeholder: true
    },

    // --- Server ---------------------------------------------------------------------------------
    {
        id: 'info',
        section: 'server',
        label: 'Server Info',
        icon: Gauge,
        path: '/server/info',
        permission: 'read_server_info_panels',
        keywords: ['status', 'resources', 'gpu', 'vram', 'usage'],
        placeholder: true
    },
    {
        id: 'backends',
        section: 'server',
        label: 'Backends',
        icon: Server,
        path: '/server/backends',
        permission: 'view_backends_list',
        keywords: ['comfy', 'comfyui', 'gpu', 'backend', 'worker'],
        placeholder: true
    },
    {
        id: 'configuration',
        section: 'server',
        label: 'Configuration',
        icon: SlidersHorizontal,
        path: '/server/configuration',
        permission: 'read_server_settings',
        keywords: ['settings', 'config', 'paths', 'network'],
        placeholder: true
    },
    {
        id: 'users',
        section: 'server',
        label: 'Users',
        icon: Users,
        path: '/server/users',
        permission: ['manage_users', 'configure_roles'],
        keywords: ['accounts', 'roles', 'permissions', 'login'],
        placeholder: true
    },
    {
        id: 'extensions',
        section: 'server',
        label: 'Extensions',
        icon: Puzzle,
        path: '/server/extensions',
        permission: 'manage_extensions',
        keywords: ['plugin', 'addon', 'install extension'],
        placeholder: true
    },
    {
        id: 'logs',
        section: 'server',
        label: 'Logs',
        icon: ScrollText,
        path: '/server/logs',
        permission: 'view_logs',
        keywords: ['log', 'debug', 'error', 'console', 'output'],
        placeholder: true
    },

    // --- Settings (was the User tab) ------------------------------------------------------------
    {
        id: 'account',
        section: 'settings',
        label: 'Account',
        icon: KeyRound,
        path: '/settings/account',
        keywords: ['user info', 'password', 'api key', 'auth token', 'profile'],
        placeholder: true
    },
    {
        id: 'preferences',
        section: 'settings',
        label: 'Preferences',
        icon: SlidersHorizontal,
        path: '/settings/preferences',
        permission: 'read_user_settings',
        keywords: ['user settings', 'theme', 'language', 'file format'],
        placeholder: true
    },
    {
        id: 'parameters',
        section: 'settings',
        label: 'Parameter Configuration',
        icon: ListTree,
        path: '/settings/parameters',
        permission: 'edit_params',
        keywords: ['param config', 'ordering', 'visibility', 'advanced'],
        placeholder: true
    },
    {
        id: 'appearance',
        section: 'settings',
        label: 'Appearance',
        icon: Image,
        path: '/settings/appearance',
        keywords: ['theme', 'layout', 'density', 'dark', 'light'],
        placeholder: true
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
