/** Server facts scraped out of the legacy page's markup.
 *
 * The Server Info tab renders these values server-side into Razor markup rather than exposing them
 * over the API — network reachability from Program.ServerSettings.Network / ProxyHandler, install
 * health from Utilities.DotNetVersMissing / Program.CurrentGitDate, and the release notice from
 * Program.VersionUpdateMessageShort (src/Pages/_Generate/ServerTab.cshtml, and #version_display in
 * src/Pages/Shared/_Layout.cshtml). There is no API route for any of it.
 *
 * So this fetches the legacy page from the same origin and reads the values back out of the HTML.
 * That makes the module coupled to legacy markup, which is the trade for not touching the server:
 * every lookup below names the element it reads, and every field is optional. A markup change on
 * the legacy side makes a field go missing and the matching row disappear — it does not throw.
 */

/** The legacy genpage. Rendering it has no side effects: GeneratePageModel only reads the login
 *  cookie (src/Utils/GeneratePageModel.cs:21). */
const LEGACY_PAGE = '/Text2Image';

export interface LegacyNetworkInfo {
    /** True when the Host setting is localhost/127.0.0.1, so nothing else can reach the server. */
    localOnly: boolean;
    /** Comma-separated LAN URLs, when Swarm is open to the network and could resolve an address. */
    lanAddresses?: string;
    /** The raw Host setting, when Swarm is open to LAN but the address could not be resolved. */
    unknownHost?: string;
    /** ngrok/cloudflared URL, when a public proxy is running. */
    publicUrl?: string;
}

export interface LegacyServerInfo {
    /** Assembly version, eg '0.9.6.0'. */
    version?: string;
    /** Date of the running git commit. Absent while the check is still running at boot. */
    gitDate?: string;
    /** True when Swarm was not installed as a git checkout, which breaks auto-updating. */
    gitFailed: boolean;
    /** Major DotNET version that is missing, eg '10'. */
    dotnetMissing?: string;
    /** True when the legacy page offers a one-click DotNET install, ie the server is on Windows. */
    canInstallDotnet: boolean;
    network: LegacyNetworkInfo;
    /** Notice about a newer release, when one exists. */
    update?: { message: string; url?: string };
    /** Whether the server checks for updates on its own, from window.checkForUpdatesAutomatically. */
    autoUpdateCheck: boolean;
}

/** textContent, but with line structure preserved.
 *
 * The legacy cards separate a label from its value with nothing but a <br>, and separate one
 * statement from the next with a <p>. Plain textContent drops both, running "...at:" straight into
 * the URL that follows and one paragraph into the next. */
function blockText(element: Element | null | undefined): string {
    if (!element) {
        return '';
    }
    const clone = element.cloneNode(true) as Element;
    for (const br of Array.from(clone.querySelectorAll('br'))) {
        br.replaceWith('\n');
    }
    for (const block of Array.from(clone.querySelectorAll('p, div'))) {
        block.prepend('\n');
        block.append('\n');
    }
    return clone.textContent ?? '';
}

function textLines(text: string): string[] {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
}

/** The line following the one containing `marker`, which is where these cards put their values. */
function valueAfter(lines: string[], marker: string): string | undefined {
    const index = lines.findIndex(line => line.includes(marker));
    if (index < 0) {
        return undefined;
    }
    return lines[index + 1] || undefined;
}

/** The body of the panel headed by `header`, which has no id of its own to go by.
 *
 * The legacy page draws such a panel two ways and has moved things between them: as a card of its
 * own with a `.card-header`, or as a titled section sharing a card with its neighbours. Both are
 * accepted, so that a panel moving from one to the other does not blank the row here. */
function panelBody(doc: Document, header: string): Element | null {
    for (const card of Array.from(doc.querySelectorAll('.card'))) {
        if (card.querySelector('.card-header')?.textContent?.trim() === header) {
            return card.querySelector('.card-body');
        }
    }
    for (const title of Array.from(doc.querySelectorAll('.server-status-section-title'))) {
        if (title.textContent?.trim() === header) {
            // The section itself: its heading reads back as one more line, which no lookup below
            // is looking for.
            return title.parentElement;
        }
    }
    return null;
}

function parseNetwork(doc: Document): LegacyNetworkInfo {
    const lines = textLines(blockText(panelBody(doc, 'Local Network')));
    return {
        localOnly: lines.some(line => line.includes('only accessible from this computer')),
        lanAddresses: valueAfter(lines, 'following addresses:'),
        // Rendered as '<b>host</b>' with literal quotes around it.
        unknownHost: valueAfter(lines, 'Unknown local address')?.replace(/^'|'$/g, ''),
        publicUrl: valueAfter(lines, 'open internet at:')
    };
}

function parseUpdate(doc: Document): LegacyServerInfo['update'] {
    // The only <div> inside the Update panel's text, and present only when a release is available.
    // Scoped to '.card-text' rather than the panel, whose own heading is a <div> as well.
    const notice = doc.querySelector('#server_updates_card .card-text div');
    const message = blockText(notice).trim();
    if (!message) {
        return undefined;
    }
    return { message, url: notice?.querySelector('a')?.getAttribute('href') ?? undefined };
}

export function parseLegacyServerInfo(html: string): LegacyServerInfo {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // '<div id="version_display">SwarmUI v<span>{version}</span><span> ({git date})</span></div>'
    const versionParts = doc.querySelectorAll('#version_display span');
    const gitDate = versionParts[1]?.textContent?.trim().replace(/^\(|\)$/g, '');
    const dotnetMessage = doc.querySelector('#dotnet_missing_message')?.textContent ?? '';
    return {
        version: versionParts[0]?.textContent?.trim() || undefined,
        gitDate: gitDate || undefined,
        gitFailed: doc.querySelector('#git_failed_message') !== null || gitDate === 'Git failed to load',
        dotnetMissing: /DotNET (\d+)/.exec(dotnetMessage)?.[1],
        // Only rendered under WebUtil.IsWindows().
        canInstallDotnet: doc.querySelector('#dotnet_install_update_button') !== null,
        network: parseNetwork(doc),
        update: parseUpdate(doc),
        autoUpdateCheck: /window\.checkForUpdatesAutomatically\s*=\s*true/.test(html)
    };
}

export async function fetchLegacyServerInfo(): Promise<LegacyServerInfo> {
    const response = await fetch(LEGACY_PAGE, { credentials: 'same-origin' });
    if (!response.ok) {
        throw new Error(`The legacy interface returned HTTP ${response.status}.`);
    }
    return parseLegacyServerInfo(await response.text());
}
