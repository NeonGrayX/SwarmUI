/** The upstream API key types the server has registered, scraped out of the legacy page.
 *
 * UserUpstreamApiKeys.KeysByType (src/WebAPI/UserUpstreamApiKeys.cs) is the registry extensions add
 * to, but no API route lists it: the legacy User tab renders it straight into a Razor table
 * (`#api_keys_table`, src/Pages/_Generate/UserTab.cshtml). So it is read back out of that markup,
 * the same way the Server Info and Extensions pages get theirs; see the note in legacyInfo.
 */

import { fetchLegacyPage } from '@/server/legacyInfo';

export interface LegacyApiKey {
    /** Storage id, eg 'civitai_api'. */
    keyType: string;
    title: string;
    createLink: string;
    /** The registry's info HTML, as plain text. */
    info: string;
}

export function parseLegacyApiKeys(html: string): LegacyApiKey[] {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('#api_keys_table tr[data-key]'));
    if (rows.length === 0 && !doc.querySelector('#api_keys_table')) {
        throw new Error('No API key table in the legacy page.');
    }
    return rows
        .map(row => {
            const cells = row.querySelectorAll('td');
            return {
                keyType: row.getAttribute('data-key') ?? '',
                title: cells[0]?.textContent?.trim() ?? '',
                createLink: cells[3]?.querySelector('a')?.getAttribute('href') ?? '',
                info: cells[4]?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            };
        })
        .filter(key => key.keyType && key.title);
}

export async function fetchLegacyApiKeys(): Promise<LegacyApiKey[]> {
    return parseLegacyApiKeys(await fetchLegacyPage());
}
