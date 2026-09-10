import {
    createRootRoute,
    createRoute,
    createRouter,
    redirect,
    type AnyRoute
} from '@tanstack/react-router';
import { lazy, Suspense, type ComponentType } from 'react';
import { AppShell } from './components/shell/AppShell';
import { RequirePermission } from './api/permissions';
import { Placeholder } from './pages/Placeholder';
import { GeneratePage } from './pages/Generate';
import { DESTINATIONS, type Destination } from './nav/destinations';

/** A screen that is fetched the first time it is needed.
 *
 * Only the workspace ships in the initial bundle - it is what `/` redirects to, so splitting it
 * would buy nothing but a round trip before the first paint. Everything else is its own chunk:
 * the Server screens, the Tools, and the Library are each a few tens of kilobytes that most
 * sessions never open.
 *
 * `preload` is the same import as the component's, handed to the route as its loader so the
 * router fetches the chunk when a link is hovered (`defaultPreload: 'intent'`) and awaits it
 * before swapping screens - the module registry dedupes the two calls, so navigating lands on a
 * rendered screen rather than on a spinner. */
interface Screen {
    Component: ComponentType;
    preload: () => Promise<unknown>;
}

function screen<M>(load: () => Promise<M>, pick: (module: M) => ComponentType): Screen {
    return {
        Component: lazy(() => load().then(module => ({ default: pick(module) }))),
        preload: load
    };
}

/** Every Library destination shares one screen, keyed by destination id, and so shares one chunk. */
function libraryScreen(id: string): Screen {
    const load = () => import('./pages/Library');
    return screen(load, module => () => <module.LibraryPage destinationId={id} />);
}

/** Destinations that have a real screen. Anything not listed renders a placeholder. */
const IMPLEMENTED: Record<string, Screen> = {
    workspace: { Component: GeneratePage, preload: () => Promise.resolve() },
    ...Object.fromEntries(
        [
            'history',
            'models',
            'loras',
            'vaes',
            'embeddings',
            'controlnets',
            'wildcards',
            'presets',
            'workflows'
        ].map(id => [id, libraryScreen(id)] as const)
    ),
    // Server
    info: screen(() => import('./pages/server/ServerInfo'), m => m.ServerInfoPage),
    backends: screen(() => import('./pages/server/Backends'), m => m.BackendsPage),
    configuration: screen(() => import('./pages/server/ServerConfiguration'), m => m.ServerConfigurationPage),
    users: screen(() => import('./pages/server/Users'), m => m.UsersPage),
    extensions: screen(() => import('./pages/server/Extensions'), m => m.ExtensionsPage),
    logs: screen(() => import('./pages/server/Logs'), m => m.LogsPage),
    // Settings
    account: screen(() => import('./pages/settings/Account'), m => m.AccountPage),
    preferences: screen(() => import('./pages/settings/Preferences'), m => m.PreferencesPage),
    parameters: screen(() => import('./pages/settings/ParameterConfig'), m => m.ParameterConfigPage),
    appearance: screen(() => import('./pages/settings/Appearance'), m => m.AppearancePage),
    // Tools
    tokenizer: screen(() => import('./pages/tools/Tokenizer'), m => m.TokenizerPage),
    downloader: screen(() => import('./pages/tools/Downloader'), m => m.DownloaderPage),
    pickle2safetensors: screen(() => import('./pages/tools/PickleToSafetensors'), m => m.PickleToSafetensorsPage),
    'lora-extractor': screen(() => import('./pages/tools/LoraExtractor'), m => m.LoraExtractorPage),
    metadata: screen(() => import('./pages/tools/MetadataUtilities'), m => m.MetadataUtilitiesPage)
};

/** Search-parameter contracts, for the few screens that are deep-linked into.
 *  Keyed by destination id so routeFor stays generic. */
const SEARCH_VALIDATORS: Record<string, (search: Record<string, unknown>) => Record<string, unknown>> = {
    // A backend card links here with the log tracker name to preselect, eg ?types=ComfyUI-0.
    // A remote Swarm backend has no tracker here, so it links by backend id instead, eg ?backend=3,
    // which switches the viewer over to reading that server's logs through the RemoteLogs proxy.
    // Backend ids are numeric, and kept numeric: the default parser reads `?backend=0` as the
    // number 0, and handing a string back would have the stringifier quote it into `?backend=%220%22`.
    logs: search => {
        const backend = backendId(search.backend);
        return {
            ...(typeof search.types === 'string' ? { types: search.types } : {}),
            ...(backend === null ? {} : { backend })
        };
    },
    // The command palette links to a single setting or parameter by id, eg ?focus=Paths.ModelRoot.
    workspace: focusSearch,
    configuration: focusSearch,
    preferences: focusSearch
};

function focusSearch(search: Record<string, unknown>): { focus?: string } {
    return typeof search.focus === 'string' ? { focus: search.focus } : {};
}

/** A backend id from the URL, or null for anything that isn't one. Written by hand it arrives as a
 *  string, so it is coerced rather than type-checked; an empty value is not a zero. */
function backendId(raw: unknown): number | null {
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
}

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
        throw redirect({ to: '/generate' });
    }
});

function routeFor(destination: Destination): AnyRoute {
    const implemented = IMPLEMENTED[destination.id];
    return createRoute({
        getParentRoute: () => rootRoute,
        path: destination.path,
        validateSearch: SEARCH_VALIDATORS[destination.id],
        // Resolves to nothing: the point is the fetch, not the module.
        loader: implemented && (async () => void (await implemented.preload())),
        component: () => (
            <RequirePermission perm={destination.permission}>
                {implemented ? (
                    // The loader has already fetched the chunk, so this only covers the frame
                    // React needs to pick the resolved module up.
                    <Suspense fallback={null}>
                        <implemented.Component />
                    </Suspense>
                ) : (
                    <Placeholder destination={destination} />
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
