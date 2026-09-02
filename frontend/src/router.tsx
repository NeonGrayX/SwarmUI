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
import { LibraryPage } from './pages/Library';
import { ServerInfoPage } from './pages/server/ServerInfo';
import { BackendsPage } from './pages/server/Backends';
import { ServerConfigurationPage } from './pages/server/ServerConfiguration';
import { UsersPage } from './pages/server/Users';
import { LogsPage } from './pages/server/Logs';
import { AccountPage } from './pages/settings/Account';
import { PreferencesPage } from './pages/settings/Preferences';
import { ParameterConfigPage } from './pages/settings/ParameterConfig';
import { TokenizerPage } from './pages/tools/Tokenizer';
import { DownloaderPage } from './pages/tools/Downloader';
import { PickleToSafetensorsPage } from './pages/tools/PickleToSafetensors';
import { LoraExtractorPage } from './pages/tools/LoraExtractor';
import { MetadataUtilitiesPage } from './pages/tools/MetadataUtilities';
import { AppearancePage } from './pages/settings/Appearance';
import { DESTINATIONS, type Destination } from './nav/destinations';

/** Destinations that have a real screen. Anything not listed renders a placeholder. */
const IMPLEMENTED: Record<string, ComponentType> = {
    workspace: GeneratePage,
    // Every Library destination shares one shell, keyed by destination id.
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
        ].map(
            id => [id, () => <LibraryPage destinationId={id} />] as const
        )
    ),
    // Server
    info: ServerInfoPage,
    backends: BackendsPage,
    configuration: ServerConfigurationPage,
    users: UsersPage,
    logs: LogsPage,
    // Settings
    account: AccountPage,
    preferences: PreferencesPage,
    parameters: ParameterConfigPage,
    // Tools
    tokenizer: TokenizerPage,
    downloader: DownloaderPage,
    pickle2safetensors: PickleToSafetensorsPage,
    'lora-extractor': LoraExtractorPage,
    metadata: MetadataUtilitiesPage,
    appearance: AppearancePage
};

/** Destinations with no screen of their own, keyed to the translation identifier for their
 *  one-line description. Extensions is the only one; its work still lives in the legacy
 *  Extensions tab, so the placeholder points there. */
const UNBUILT: Record<string, string> = {
    extensions: 'placeholder.summary.extensions'
};

/** Search-parameter contracts, for the few screens that are deep-linked into.
 *  Keyed by destination id so routeFor stays generic. */
const SEARCH_VALIDATORS: Record<string, (search: Record<string, unknown>) => Record<string, unknown>> = {
    // A backend card links here with the log tracker name to preselect, eg ?types=ComfyUI-0.
    logs: search => (typeof search.types === 'string' ? { types: search.types } : {}),
    // The command palette links to a single setting or parameter by id, eg ?focus=Paths.ModelRoot.
    workspace: focusSearch,
    configuration: focusSearch,
    preferences: focusSearch
};

function focusSearch(search: Record<string, unknown>): { focus?: string } {
    return typeof search.focus === 'string' ? { focus: search.focus } : {};
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
    const Screen = IMPLEMENTED[destination.id];
    return createRoute({
        getParentRoute: () => rootRoute,
        path: destination.path,
        validateSearch: SEARCH_VALIDATORS[destination.id],
        component: () => (
            <RequirePermission perm={destination.permission}>
                {Screen ? (
                    <Screen />
                ) : (
                    <Placeholder destination={destination} summaryKey={UNBUILT[destination.id]} />
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
