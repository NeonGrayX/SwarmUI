/** Permission gating. Permissions arrive with the session (GetNewSession returns the user's full
 *  permission list), so no extra request is needed.
 */

import type { ReactNode } from 'react';
import { useTranslation, trailingFragment } from '@/i18n';
import { useSession } from './hooks';

/** One permission id, or several of which any one suffices. */
export type PermissionRequirement = string | string[];

/** The owner role carries this instead of the full list, and it stands in for every permission
 *  (User.HasPermission, src/Accounts/User.cs:345). The server never expands it for us. */
const WILDCARD = '*';

function granted(held: string[], required: PermissionRequirement): boolean {
    if (held.includes(WILDCARD)) {
        return true;
    }
    if (Array.isArray(required)) {
        return required.some(perm => held.includes(perm));
    }
    return held.includes(required);
}

/** True if the current session grants `perm`. Undefined `perm` means "no gate".
 *  An array means "any one of these is enough". */
export function usePermission(perm: PermissionRequirement | undefined): boolean {
    const session = useSession();
    if (!perm) {
        return true;
    }
    const held = session.data?.permissions;
    return held ? granted(held, perm) : false;
}

/** Filters a list of permission-gated items down to those the user may see. */
export function usePermitted<T extends { permission?: PermissionRequirement }>(items: T[]): T[] {
    const session = useSession();
    const held = session.data?.permissions;
    if (!held) {
        return [];
    }
    return items.filter(item => !item.permission || granted(held, item.permission));
}

export function RequirePermission(props: {
    perm?: PermissionRequirement;
    children: ReactNode;
    fallback?: ReactNode;
}) {
    const allowed = usePermission(props.perm);
    if (!allowed) {
        return <>{props.fallback ?? <PermissionDenied perm={props.perm} />}</>;
    }
    return <>{props.children}</>;
}

function PermissionDenied(props: { perm?: PermissionRequirement }) {
    const { t } = useTranslation();
    const names = props.perm === undefined ? [] : Array.isArray(props.perm) ? props.perm : [props.perm];
    return (
        <div className="p-8">
            <h2 className="text-lg font-medium text-fg-strong mb-1">{t('permissionDenied.title')}</h2>
            <p className="text-fg-soft">
                {t('permissionDenied.before')}{' '}
                {names.map((name, index) => (
                    <span key={name}>
                        {index > 0 && (index === names.length - 1 ? t('common.orSeparator') : ', ')}
                        <code className="font-mono text-fg">{name}</code>
                    </span>
                ))}
                {trailingFragment(t('permissionDenied.after', { count: names.length }))}
            </p>
        </div>
    );
}
