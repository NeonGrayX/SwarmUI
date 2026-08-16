import {
    createRootRoute,
    createRoute,
    createRouter,
    redirect,
    type AnyRoute
} from '@tanstack/react-router';
import { type ComponentType } from 'react';
import { AppShell } from './components/shell/AppShell';
import { RequirePermission } from './api/permissions';
import { Placeholder } from './pages/Placeholder';
import { GeneratePage } from './pages/Generate';
import { DESTINATIONS, type Destination } from './nav/destinations';

/** Destinations that have a real screen. Anything not listed renders an honest placeholder. */
const IMPLEMENTED: Record<string, ComponentType> = {
    workspace: GeneratePage
};

/** Which phase of the build delivers each screen, and a one-line summary of what it will do.
 *  Drives the placeholders so every routed screen is honest about its state. */
const PHASE_INFO: Record<string, { phase: string; summary: string }> = {
    workspace: {
        phase: 'Phase 3',
        summary: 'Prompt composer, parameters, canvas and batch rail in one resizable workspace.'
    },
    history: { phase: 'Phase 4', summary: 'Everything you have generated, browsable and searchable.' },
    models: { phase: 'Phase 4', summary: 'Browse, star, edit metadata for and load your checkpoints.' },
    loras: { phase: 'Phase 4', summary: 'Browse and manage LoRA adapters.' },
    vaes: { phase: 'Phase 4', summary: 'Browse and manage VAE models.' },
    embeddings: { phase: 'Phase 4', summary: 'Browse and manage textual inversion embeddings.' },
    controlnets: { phase: 'Phase 4', summary: 'Browse and manage ControlNet models.' },
    wildcards: { phase: 'Phase 4', summary: 'Create and edit wildcard lists for dynamic prompts.' },
    presets: { phase: 'Phase 4', summary: 'Saved parameter sets you can apply to a generation.' },
    tokenizer: { phase: 'Phase 6', summary: 'Inspect how the text encoder splits a prompt into tokens.' },
    downloader: { phase: 'Phase 6', summary: 'Fetch models from Civitai or Hugging Face by URL.' },
    pickle2safetensors: { phase: 'Phase 6', summary: 'Convert legacy pickle checkpoints to safetensors.' },
    'lora-extractor': { phase: 'Phase 6', summary: 'Extract a LoRA from the difference between two models.' },
    metadata: { phase: 'Phase 6', summary: 'Rebuild metadata databases and scan Civitai for model info.' },
    info: { phase: 'Phase 5', summary: 'Live server resource usage and version information.' },
    backends: { phase: 'Phase 5', summary: 'Add, configure, restart and monitor generation backends.' },
    configuration: { phase: 'Phase 5', summary: 'Server-wide settings: paths, metadata, network, defaults.' },
    users: { phase: 'Phase 5', summary: 'Accounts, roles and permissions.' },
    extensions: { phase: 'Phase 5', summary: 'Install, update and enable Swarm extensions.' },
    logs: { phase: 'Phase 5', summary: 'Live server logs with level filtering.' },
    account: { phase: 'Phase 5', summary: 'Your profile, password, API keys and auth tokens.' },
    preferences: { phase: 'Phase 5', summary: 'Your personal settings: theme, language, output format.' },
    parameters: { phase: 'Phase 5', summary: 'Reconfigure how generation parameters are presented.' },
    appearance: { phase: 'Phase 7', summary: 'Theme and layout density for this interface.' }
};

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
        throw redirect({ to: '/generate' });
    }
});

function routeFor(destination: Destination): AnyRoute {
    const info = PHASE_INFO[destination.id] ?? { phase: 'a later phase', summary: '' };
    const Screen = IMPLEMENTED[destination.id];
    return createRoute({
        getParentRoute: () => rootRoute,
        path: destination.path,
        component: () => (
            <RequirePermission perm={destination.permission}>
                {Screen ? (
                    <Screen />
                ) : (
                    <Placeholder destination={destination} phase={info.phase} summary={info.summary} />
                )}
            </RequirePermission>
        )
    });
}

const routeTree = rootRoute.addChildren([indexRoute, ...DESTINATIONS.map(routeFor)]);

export const router = createRouter({
    routeTree,
    // The app is mounted at /ui by the Swarm webserver (see NewUIPath in src/Core/WebServer.cs).
    basepath: '/ui',
    defaultPreload: 'intent'
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
