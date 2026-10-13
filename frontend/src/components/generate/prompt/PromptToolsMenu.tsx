import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from '@/i18n';
import { FILE_ACCEPT } from '@/params/media';
import { RegionDialog } from './RegionDialog';
import { SegmentDialog } from './SegmentDialog';
import { usePromptImageAttach } from './promptImages';

/** The "+" beside the prompt box: guided builders for the prompt syntax that is awkward to type by
 *  hand, a way to attach an input image, and "Other..." to browse the rest of the syntax. Ported
 *  from PromptPlusButton.showMenu (src/wwwroot/js/genpage/gentab/prompttools.js:525).
 *
 *  `onInsert` appends syntax to the prompt; `onOtherSyntax` starts a fresh `<` and lists the tags. */
export function PromptToolsMenu(props: { onInsert: (syntax: string) => void; onOtherSyntax: () => void }) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const [dialog, setDialog] = useState<'segment' | 'region' | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const attach = usePromptImageAttach();

    const add = (syntax: string) => {
        setDialog(null);
        props.onInsert(syntax);
    };
    const onDialogOpenChange = (open: boolean) => {
        if (!open) {
            setDialog(null);
        }
    };

    return (
        <>
            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={t('promptTools.button')}
                        title={t('promptTools.button')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-default bg-surface-sunken text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        <Plus size={16} aria-hidden />
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        side="top"
                        align="start"
                        sideOffset={6}
                        collisionPadding={8}
                        className="z-50 w-64 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                    >
                        <MenuItem label={t('promptTools.segment.menu')} hint={t('promptTools.segment.menuHint')} onClick={() => setDialog('segment')} />
                        <MenuItem label={t('promptTools.region.menu')} hint={t('promptTools.region.menuHint')} onClick={() => setDialog('region')} />
                        {attach.available && (
                            <MenuItem label={t('promptTools.image.menu')} hint={t('promptTools.image.menuHint')} onClick={() => fileRef.current?.click()} />
                        )}
                        <MenuItem label={t('promptTools.other.menu')} hint={t('promptTools.other.menuHint')} onClick={props.onOtherSyntax} />
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
            <input
                ref={fileRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                accept={FILE_ACCEPT.image}
                multiple
                onChange={e => {
                    void attach.addFiles(e.target.files ?? []);
                    e.target.value = '';
                }}
            />
            <SegmentDialog open={dialog === 'segment'} onOpenChange={onDialogOpenChange} onAdd={add} />
            <RegionDialog open={dialog === 'region'} onOpenChange={onDialogOpenChange} onAdd={add} />
        </>
    );
}

function MenuItem(props: { label: string; hint: string; onClick: () => void }) {
    return (
        <Popover.Close asChild>
            <button
                type="button"
                title={props.hint}
                onClick={props.onClick}
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-[var(--sw-hover)]"
            >
                {props.label}
            </button>
        </Popover.Close>
    );
}
