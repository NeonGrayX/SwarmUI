import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/** Backend routes that must be proxied to the running Swarm server during dev. */
const BACKEND_ROUTES = ['/API', '/View', '/Output', '/Audio', '/ViewSpecial', '/ExtensionFile'];

const SWARM_SERVER = process.env.SWARM_SERVER ?? 'http://localhost:7801';

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
        sourcemap: true
    },
    server: {
        port: 7802,
        proxy: Object.fromEntries(
            BACKEND_ROUTES.map(route => [route, { target: SWARM_SERVER, changeOrigin: true, ws: true }])
        )
    }
});
