import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/** Backend routes that must be proxied to the running Swarm server during dev. */
const BACKEND_ROUTES = ['/API', '/View', '/Output', '/Audio', '/ViewSpecial', '/ExtensionFile'];

const SWARM_SERVER = process.env.SWARM_SERVER ?? 'http://localhost:7801';

/** Dependencies, split off from the application code by how often they change.
 *
 * Screens are already loaded on demand (see src/router.tsx), which leaves the entry chunk as
 * mostly other people's code. Grouping it separately means a Swarm update invalidates the
 * application chunk alone, and a returning user re-downloads a few tens of kilobytes rather than
 * the whole bundle. The groups are coarse on purpose: one request each, and none of them is
 * updated without the others in practice. */
function manualChunks(id: string): string | undefined {
    if (!id.includes('node_modules')) {
        return undefined;
    }
    if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
        return 'vendor-react';
    }
    if (id.includes('node_modules/@tanstack/')) {
        return 'vendor-tanstack';
    }
    if (/node_modules\/(@radix-ui|@floating-ui|cmdk|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden)/.test(id)) {
        return 'vendor-ui';
    }
    return undefined;
}

export default defineConfig({
    // Served from /ui/ by the Swarm webserver, out of wwwroot/newui/.
    base: '/ui/',
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    build: {
        outDir: '../src/wwwroot/newui',
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            output: { manualChunks }
        }
    },
    server: {
        port: 7802,
        proxy: Object.fromEntries(
            BACKEND_ROUTES.map(route => [route, { target: SWARM_SERVER, changeOrigin: true, ws: true }])
        )
    }
});
