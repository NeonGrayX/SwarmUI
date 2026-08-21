import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Keyboard, X } from 'lucide-react';
import { useTranslation } from '@/i18n';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? 'Cmd' : 'Ctrl';

/** Key names stay literal — they are what is printed on the keyboard, not prose. Only the group
 *  headings and the action descriptions carry translation identifiers. */
const SHORTCUTS: { groupKey: string; items: { keys: string[]; actionKey: string }[] }[] = [
    {
        groupKey: 'shortcuts.group.anywhere',
        items: [
            { keys: [MOD, 'K'], actionKey: 'shortcuts.action.commandPalette' },
            { keys: ['?'], actionKey: 'shortcuts.action.showList' },
            { keys: ['Esc'], actionKey: 'shortcuts.action.closeOverlay' }
        ]
    },
    {
        groupKey: 'shortcuts.group.generate',
        items: [
            { keys: [MOD, 'Enter'], actionKey: 'shortcuts.action.generate' },
            { keys: ['Enter'], actionKey: 'shortcuts.action.newLine' }
        ]
    },
    {
        groupKey: 'shortcuts.group.panels',
        items: [
            { keys: ['Tab'], actionKey: 'shortcuts.action.focusDividers' },
            { keys: ['←', '→'], actionKey: 'shortcuts.action.resizeDivider' },
            { keys: ['Shift', '←/→'], actionKey: 'shortcuts.action.resizeLarger' }
        ]
    }
];

/** Keyboard reference, opened with `?`.
 *  The legacy UI documents its hotkeys nowhere in the interface. */
export function ShortcutsDialog() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) {
                return;
            }
            // Don't hijack a literal '?' the user is typing into a field.
            const target = e.target as HTMLElement | null;
            if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) {
                return;
            }
            e.preventDefault();
            setOpen(o => !o);
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/4 z-50 w-[min(30rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <div className="mb-3 flex items-center gap-2">
                        <Keyboard size={16} className="text-fg-soft" aria-hidden />
                        <Dialog.Title className="flex-1 text-base font-medium text-fg-strong">
                            {t('shortcuts.title')}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <X size={15} aria-hidden />
                            </button>
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="sr-only">
                        {t('shortcuts.description')}
                    </Dialog.Description>

                    {SHORTCUTS.map(section => (
                        <div key={section.groupKey} className="mb-3 last:mb-0">
                            <h3 className="mb-1 text-xs uppercase tracking-wide text-fg-soft">
                                {t(section.groupKey)}
                            </h3>
                            <ul className="space-y-1">
                                {section.items.map(item => (
                                    <li key={item.actionKey} className="flex items-center gap-3 text-sm">
                                        <span className="flex shrink-0 gap-1">
                                            {item.keys.map(key => (
                                                <kbd
                                                    key={key}
                                                    className="rounded border border-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg"
                                                    style={{ background: 'var(--sw-surface-sunken)' }}
                                                >
                                                    {key}
                                                </kbd>
                                            ))}
                                        </span>
                                        <span className="min-w-0 flex-1 text-fg-soft">{t(item.actionKey)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
