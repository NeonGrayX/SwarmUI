/** The extension lists, scraped out of the legacy page's markup.
 *
 * Swarm exposes routes for *acting* on extensions — InstallExtension, UpdateExtension,
 * UninstallExtension, SetExtensionEnabled (src/WebAPI/AdminAPI.cs) — but none for listing them:
 * the legacy Extensions tab renders Program.Extensions.Extensions, GetDisabledExtensionsForUi()
 * and KnownExtensions straight into Razor tables (src/Pages/_Generate/ServerTab.cshtml). So the
 * list comes from the same place the Server Info page gets its facts, by reading the legacy page's
 * HTML; see the note at the top of legacyInfo.
 *
 * Every lookup below is by column header or by the row's own button handlers rather than by
 * position, so a column moving on the legacy side does not silently shift the fields, and a row
 * that cannot be read at all simply does not appear.
 */

import { fetchLegacyPage } from './legacyInfo';

/** How a tag should read. The legacy page's own classes carry this distinction — `paid-tag`,
 *  `beta-tag` (beta and conflicts), `lowquality-tag`, `hidden-tag` — everything else is plain. */
export type ExtensionTagKind = 'plain' | 'caution' | 'paid' | 'hidden';

export interface ExtensionTag {
    label: string;
    /** The legacy tag's tooltip, which is what the tag actually means. */
    hint?: string;
    kind: ExtensionTagKind;
}

/** Fields every row carries, installed or not. */
export interface ExtensionEntry {
    /** Display name, from the Name column. */
    name: string;
    /** What the API routes want for this row: the extension name while it is loaded, the folder
     *  name while it is disabled. Read off the row's own buttons rather than assumed. */
    actionName: string;
    author: string;
    description: string;
    tags: ExtensionTag[];
    /** The extension's readme, absent when the legacy row lists none. */
    readmeUrl?: string;
    license: string;
    /** Anything but MIT, which is the line the legacy page draws when it highlights a license. */
    licenseWarning: boolean;
}

export interface InstalledExtension extends ExtensionEntry {
    /** Version of a loaded extension. Absent while it is disabled — nothing has loaded to ask. */
    version?: string;
    enabled: boolean;
    /** The extension's repo moved, so it has to be uninstalled and reinstalled to keep updating. */
    oldRepo: boolean;
    /** Whether the legacy row offers an update, ie the server found a git checkout to pull. */
    canUpdate: boolean;
}

export interface LegacyExtensions {
    /** Installed extensions, enabled ones first, as the legacy table orders them. */
    installed: InstalledExtension[];
    /** Known extensions that are not installed. Legacy drops `hidden` ones server-side and sorts
     *  the riskier tags last, both of which carry over into this list's order. */
    available: ExtensionEntry[];
}

const TAG_KINDS: [string, ExtensionTagKind][] = [
    ['paid-tag', 'paid'],
    ['beta-tag', 'caution'],
    ['lowquality-tag', 'caution'],
    ['hidden-tag', 'hidden']
];

function parseTags(cell: Element | undefined): ExtensionTag[] {
    return Array.from(cell?.querySelectorAll('.tag') ?? [])
        .map(tag => ({
            label: tag.textContent?.trim() ?? '',
            hint: tag.getAttribute('title') ?? undefined,
            kind: TAG_KINDS.find(([css]) => tag.classList.contains(css))?.[1] ?? 'plain'
        }))
        .filter(tag => tag.label);
}

function text(cell: Element | undefined): string {
    return cell?.textContent?.trim() ?? '';
}

/** The href of a cell's link. The legacy tables write '(Missing)' as plain text when there is
 *  none, which has no link to find. */
function link(cell: Element | undefined): string | undefined {
    return cell?.querySelector('a')?.getAttribute('href') || undefined;
}

/** The extension name a row's buttons hand to the API, from the first `onclick` calling `method`.
 *
 * Legacy renders these as `extensionsManager.installExtension('Name', this)`, and for a disabled
 * row it passes the folder name rather than the display name — the enable and uninstall routes
 * want that, so the argument is read rather than the Name column reused. `args` narrows the match
 * when one method serves two buttons, as `setExtensionEnabled` does with its true/false. */
function actionArg(cell: Element | undefined, method: string, args = ''): string | undefined {
    for (const button of Array.from(cell?.querySelectorAll('button') ?? [])) {
        const pattern = new RegExp(`${method}\\('([^']*)'${args ? `,\\s*${args}` : ''}`);
        const match = pattern.exec(button.getAttribute('onclick') ?? '');
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

/** Reads a table's rows as records keyed by lowercased column header. */
function rowsByHeader(table: Element | undefined): Record<string, Element | undefined>[] {
    if (!table) {
        return [];
    }
    const headers = Array.from(table.querySelectorAll('th')).map(th => text(th).toLowerCase());
    return Array.from(table.querySelectorAll('tr'))
        .map(row => Array.from(row.querySelectorAll('td')))
        .filter(cells => cells.length > 0)
        .map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
}

/** Description text without the trailing old-repo warning, which is rendered as its own note. */
function description(cell: Element | undefined): string {
    if (!cell) {
        return '';
    }
    const clone = cell.cloneNode(true) as Element;
    for (const warning of Array.from(clone.querySelectorAll('.modal_error_bottom'))) {
        warning.remove();
    }
    return text(clone);
}

function entry(row: Record<string, Element | undefined>, actionName: string): ExtensionEntry {
    const license = text(row.license);
    return {
        name: text(row.name),
        actionName,
        author: text(row.author),
        description: description(row.description),
        tags: parseTags(row.tags),
        readmeUrl: link(row.readme),
        license,
        licenseWarning: license !== 'MIT'
    };
}

function parseInstalled(row: Record<string, Element | undefined>): InstalledExtension | null {
    const actions = row.actions;
    // Which of the two enable/disable buttons the row carries is what says whether it is loaded.
    const disableName = actionArg(actions, 'setExtensionEnabled', 'false');
    const enableName = actionArg(actions, 'setExtensionEnabled', 'true');
    const actionName = disableName ?? enableName ?? actionArg(actions, 'uninstallExtension');
    if (!actionName) {
        return null;
    }
    const enabled = disableName !== undefined;
    return {
        ...entry(row, actionName),
        // A disabled row puts '(Disabled)' where the version would go.
        version: enabled ? text(row.version) || undefined : undefined,
        enabled,
        oldRepo: Boolean(row.description?.querySelector('.modal_error_bottom')),
        canUpdate: actionArg(actions, 'updateExtension') !== undefined
    };
}

export function parseLegacyExtensions(html: string): LegacyExtensions {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tables = Array.from(doc.querySelectorAll('#Server-Extensions table'));
    // Only the installed table has a Version column; the other one is the available list.
    const installedTable = tables.find(table =>
        Array.from(table.querySelectorAll('th')).some(th => text(th).toLowerCase() === 'version')
    );
    const availableTable = tables.find(table => table !== installedTable);
    return {
        installed: rowsByHeader(installedTable)
            .map(parseInstalled)
            .filter((ext): ext is InstalledExtension => ext !== null),
        available: rowsByHeader(availableTable)
            .map(row => {
                const name = actionArg(row.actions, 'installExtension');
                return name ? entry(row, name) : null;
            })
            .filter((ext): ext is ExtensionEntry => ext !== null)
    };
}

export async function fetchLegacyExtensions(): Promise<LegacyExtensions> {
    return parseLegacyExtensions(await fetchLegacyPage());
}
