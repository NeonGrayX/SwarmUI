/** Permission gating.
 *
 * Replaces the legacy `data-requiredpermission` attribute sweep in
 * src/wwwroot/js/permissions.js. Permissions arrive with the session (GetNewSession returns the
 * user's full permission list) so no extra request is needed.
 */

import type { ReactNode } from 'react';
import { useSession } from './hooks';

/** True if the current session grants `perm`. Undefined `perm` means "no gate". */
export function usePermission(perm: string | undefined): boolean {
    const session = useSession();
    if (!perm) {
        return true;
    }
    return session.data?.permissions.includes(perm) ?? false;
}

/** Filters a list of permission-gated items down to those the user may see. */
export function usePermitted<T extends { permission?: string }>(items: T[]): T[] {
    const session = useSession();
    const granted = session.data?.permissions;
    if (!granted) {
        return [];
    }
    return items.filter(item => !item.permission || granted.includes(item.permission));
}

export function RequirePermission(props: { perm?: string; children: ReactNode; fallback?: ReactNode }) {
    const allowed = usePermission(props.perm);
    if (!allowed) {
        return <>{props.fallback ?? <PermissionDenied perm={props.perm} />}</>;
    }
    return <>{props.children}</>;
}

function PermissionDenied(props: { perm?: string }) {
    return (
        <div className="p-8">
            <h2 className="text-lg font-medium text-fg-strong mb-1">Not available</h2>
            <p className="text-fg-soft">
                Your account doesn't have the{' '}
                <code className="font-mono text-fg">{props.perm}</code> permission.
            </p>
        </div>
    );
}
