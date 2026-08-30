#!/usr/bin/env bash

# Builds the new frontend UI (see 'frontend/') into 'src/wwwroot/newui', which the server serves at '/ui'.
# Sourced by the normal launch build logic, and run directly by the dockerfiles at image build time.
# Failures here are non-fatal: Swarm runs fine without it, only '/ui' is unavailable.

swarm_build_frontend() {
    local dir="./frontend"
    local out="./src/wwwroot/newui"
    local stamp="$out/.build_stamp"
    if [ ! -f "$dir/package.json" ]; then
        return 0
    fi
    if ! command -v npm > /dev/null 2>&1; then
        printf "\n\nWARNING: 'npm' is not installed, so the new UI at '/ui' cannot be built. Install NodeJS 22 or newer to enable it. Everything else works as normal.\n\n"
        return 0
    fi
    # Hash of every build input, so an unchanged frontend never rebuilds ('sha1sum' is linux, 'shasum' is mac)
    local sha="sha1sum"
    if ! command -v sha1sum > /dev/null 2>&1; then
        sha="shasum"
    fi
    local hash=`cd "$dir" && find index.html package.json package-lock.json tsconfig.json vite.config.ts src -type f -exec $sha {} + 2>/dev/null | sort | $sha | cut -d' ' -f1`
    if [ -z "$hash" ]; then
        return 0
    fi
    if [ -f "$out/index.html" ] && [ "$hash" = "`cat "$stamp" 2>/dev/null`" ]; then
        return 0
    fi
    echo "Building the new UI frontend (this may take a minute)..."
    # (Re)install node modules if they're missing or older than the lockfile
    if [ ! -d "$dir/node_modules" ] || [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]; then
        if [ -f "$dir/package-lock.json" ]; then
            (cd "$dir" && npm ci --no-audit --no-fund)
        else
            (cd "$dir" && npm install --no-audit --no-fund)
        fi
        if [ $? != 0 ]; then
            printf "\n\nWARNING: npm failed to install the new UI's dependencies, so '/ui' may be unavailable or outdated. Everything else works as normal.\n\n"
            return 0
        fi
    fi
    (cd "$dir" && npm run build)
    if [ $? != 0 ]; then
        printf "\n\nWARNING: The new UI frontend failed to build, so '/ui' may be unavailable or outdated. Everything else works as normal.\n\n"
        return 0
    fi
    echo "$hash" > "$stamp"
}

swarm_build_frontend
