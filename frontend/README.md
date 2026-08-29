# SwarmUI — new frontend

An independent SPA for SwarmUI, served at `/ui`. Talks to the same HTTP API as the existing UI
(`/API/<Call>`), so the legacy interface at `/Text2Image` keeps working untouched.

## Running

```bash
cd frontend
npm install
```

**Development** — hot reload against a running Swarm server:

```bash
npm run dev          # http://localhost:7802/ui/
```

Requires Swarm running on `http://localhost:7801` (override with `SWARM_SERVER=...`). Vite proxies
`/API`, `/View`, `/Output`, `/Audio`, `/ViewSpecial` and `/ExtensionFile` to it.

**Production** — build into the server's static files:

```bash
npm run build        # -> ../src/wwwroot/newui/
```

The Swarm server picks this up automatically and serves it at `http://localhost:7801/ui/`
(see `NewUIPath` in `src/Core/WebServer.cs`). If the directory is absent, `/ui` returns a message
saying so; nothing else is affected.

## Layout

```
src/
  main.tsx        Entry point: pre-paint theme, i18n bootstrap, providers.
  router.tsx      One route per entry in nav/destinations.ts.
  nav/            The navigation model. Adding a screen means adding one entry here.

  api/            Typed API client (POST /API/<Call>, X-Session-ID header, session refresh,
                  WebSocket helper), response shapes, and TanStack Query bindings.
  i18n/           `t` / `tDynamic`, the language store, and one locale file per language.
  theme/          Loads the server's theme stylesheets over the token contract.
  shell/          Viewport-class hooks, for the places a narrow screen needs a different tree.

  params/         Generation parameters: schema, client state, visibility, media, LoRAs,
                  image metadata, and "reuse parameters".
  generate/       Running a generation: request body, validation, run state, pane layout.
  editor/         Image editor engine, layers, undo, and the tools. Imperative, not React.
  library/        Model catalog and the Library browsers' data access.
  server/         Backends, users/roles/permissions, and the Server Info page scrape.
  settings/       Settings-tree shapes shared by Server Configuration and Preferences.
  tools/          Model-source resolution and the shared websocket job runner.

  pages/          One file per routed screen.
  components/     UI, grouped by the area that owns it (shell, form, generate, library,
                  server, settings, tools, editor) plus shared primitives in ui/.
  styles/
    tokens.css    Design tokens. Deliberately reuses the *same* CSS custom-property names as
                  the legacy themes (src/wwwroot/css/themes/), so those theme files can be
                  layered on unchanged. New tokens are --sw-*.
    index.css     Tailwind setup mapping tokens into the utility theme.
```

`api/types.ts` mirrors the C# serializers — keep it in sync with `T2IParamType.ToNet`
(`src/Text2Image/T2IParamTypes.cs:119`).

## Notes

- Session travels as an `X-Session-ID` header rather than a body field, so requests stay clean and
  the dev server's cross-port setup works without cookie games.
- `npm install` may report blocked install scripts; `esbuild` needs its postinstall to fetch the
  platform binary and is pre-approved in `package.json` under `allowScripts`.
- The image editor has its own architecture notes in `.agents/skills/new-ui-image-editor/`.
