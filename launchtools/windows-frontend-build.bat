@echo off

rem Builds the new frontend UI (see 'frontend/') into 'src\wwwroot\newui', which the server serves at '/ui'.
rem Called by launch-windows.bat. Failures here are non-fatal: Swarm runs fine without it, only '/ui' is unavailable.

if not exist frontend\package.json exit /b 0

where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo WARNING: 'npm' is not installed, so the new UI at '/ui' cannot be built. Install NodeJS 22 or newer to enable it. Everything else works as normal.
    echo.
    exit /b 0
)

rem Hash of every build input, so an unchanged frontend never rebuilds
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$files = @(Get-ChildItem -Path frontend\src -Recurse -File) + @(Get-Item frontend\index.html, frontend\package.json, frontend\package-lock.json, frontend\tsconfig.json, frontend\vite.config.ts); $all = ($files ^| Sort-Object FullName ^| ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA1).Hash }) -join ''; (Get-FileHash -InputStream ([System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($all))) -Algorithm SHA1).Hash"') do set FE_HASH=%%i

set FE_STAMP=
if exist src\wwwroot\newui\.build_stamp set /p FE_STAMP=<src\wwwroot\newui\.build_stamp
if exist src\wwwroot\newui\index.html if "%FE_HASH%"=="%FE_STAMP%" exit /b 0

echo Building the new UI frontend (this may take a minute)...

rem (Re)install node modules if they're missing or older than the lockfile
set FE_NPMCI=yes
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Test-Path frontend\node_modules\.package-lock.json) -and (Get-Item frontend\node_modules\.package-lock.json).LastWriteTime -ge (Get-Item frontend\package-lock.json).LastWriteTime) { 'no' } else { 'yes' }"') do set FE_NPMCI=%%i

pushd frontend
if "%FE_NPMCI%"=="yes" (
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
        popd
        echo.
        echo WARNING: npm failed to install the new UI's dependencies, so '/ui' may be unavailable or outdated. Everything else works as normal.
        echo.
        exit /b 0
    )
)
call npm run build
set FE_BUILD_ERR=%ERRORLEVEL%
popd

if not "%FE_BUILD_ERR%"=="0" (
    echo.
    echo WARNING: The new UI frontend failed to build, so '/ui' may be unavailable or outdated. Everything else works as normal.
    echo.
    exit /b 0
)

rem Note: redirect written before the echo, so a hash ending in a digit isn't read as a stream handle
>src\wwwroot\newui\.build_stamp echo %FE_HASH%
exit /b 0
