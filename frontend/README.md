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
  api/
    client.ts    Typed API client: POST /API/<Call>, X-Session-ID header, session
                 refresh on `invalid_session_id`, WebSocket streaming helper.
    types.ts     Response shapes. Mirrors the C# serializers - keep in sync with
                 T2IParamType.ToNet (src/Text2Image/T2IParamTypes.cs:119).
    hooks.ts     TanStack Query bindings.
  styles/
    tokens.css   Design tokens. Deliberately reuses the *same* CSS custom-property
                 names as the legacy themes (src/wwwroot/css/themes/), so those 15
                 theme files can be layered on unchanged. New tokens are --sw-*.
    index.css    Tailwind setup mapping tokens into the utility theme.
```

## Notes

- Session travels as an `X-Session-ID` header rather than a body field, so requests stay clean and
  the dev server's cross-port setup works without cookie games.
- `npm install` may report blocked install scripts; `esbuild` needs its postinstall to fetch the
  platform binary and is pre-approved in `package.json` under `allowScripts`.
