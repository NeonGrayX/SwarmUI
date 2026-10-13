import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import { useParamSchema } from '@/params/schema';
import { defaultValue, useParamStore } from '@/params/store';
import { useTranslation } from '@/i18n';

/** Tips shown on an empty canvas, cycled with the arrows. Ported from the legacy welcome messages
 *  (src/wwwroot/js/genpage/gentab/welcomemessages.js), less the ones about features this UI does not
 *  have, plus a couple about its own. */
const TIPS = [
    'welcome.tip.prompt',
    'welcome.tip.discord',
    'welcome.tip.patreon',
    'welcome.tip.imagePrompt',
    'welcome.tip.variationSeed',
    'welcome.tip.serverLogs',
    'welcome.tip.promptSyntax',
    'welcome.tip.updates',
    'welcome.tip.dropImage',
    'welcome.tip.batchKeys'
];

/** Links named in a tip, by the `{token}` it uses. */
const LINKS: Record<string, { href: string; labelKey: string }> = {
    discord: { href: 'https://discord.gg/q2y38cqjNw', labelKey: 'welcome.link.discord' },
    patreon: { href: 'https://patreon.com/swarmui', labelKey: 'welcome.link.patreon' },
    syntaxDocs: {
        href: 'https://github.com/mcmonkeyprojects/SwarmUI/blob/master/docs/Features/Prompt%20Syntax.md',
        labelKey: 'welcome.link.syntaxDocs'
    }
};

/** Splits a translated tip on `{token}`s, turning each known one into its external link. */
function renderTip(text: string, t: (key: string) => string): ReactNode[] {
    return text.split(/(\{[a-zA-Z]+\})/).map((part, index) => {
        const link = LINKS[part.slice(1, -1)];
        if (!part.startsWith('{') || !link) {
            return part;
        }
        return (
            <a
                key={index}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
                style={{ color: 'var(--emphasis)' }}
            >
                {t(link.labelKey)}
            </a>
        );
    });
}

/** What the canvas says before there is anything to show: a nudge to pick a model when there is
 *  none, otherwise a random tip. */
export function WelcomeMessage(props: { children?: ReactNode }) {
    const { t } = useTranslation();
    const schema = useParamSchema();
    const chosenModel = useParamStore(s => s.values.model);
    const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length));

    const modelParam = schema?.byId.get('model');
    const model = chosenModel ?? (modelParam ? defaultValue(modelParam) : null);
    const installed = schema ? (schema.models[modelParam?.subtype ?? 'Stable-Diffusion'] ?? []) : null;

    let body: ReactNode;
    if (schema && modelParam && !model) {
        body =
            installed && installed.length === 0 ? (
                <p>
                    {t('welcome.noModels')}{' '}
                    <Link to="/server/configuration" className="underline underline-offset-2" style={{ color: 'var(--emphasis)' }}>
                        {t('welcome.serverConfiguration')}
                    </Link>
                </p>
            ) : (
                <p>
                    {t('welcome.selectModel')}{' '}
                    <Link to="/library/models" className="underline underline-offset-2" style={{ color: 'var(--emphasis)' }}>
                        {t('welcome.modelsLink')}
                    </Link>
                </p>
            );
    }
    else {
        const step = (delta: number) => setIndex(current => (current + delta + TIPS.length) % TIPS.length);
        body = (
            <>
                <p className="min-h-[3lh] whitespace-pre-line">{renderTip(t(TIPS[index]), t)}</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                    <TipButton label={t('welcome.previousTip')} onClick={() => step(-1)}>
                        <ChevronLeft size={14} aria-hidden />
                    </TipButton>
                    <span className="text-xs tabular-nums text-fg-soft">
                        {t('viewer.position', { index: index + 1, total: TIPS.length })}
                    </span>
                    <TipButton label={t('welcome.nextTip')} onClick={() => step(1)}>
                        <ChevronRight size={14} aria-hidden />
                    </TipButton>
                </div>
            </>
        );
    }

    return (
        <div className="max-w-md px-4 text-center text-sm text-fg-soft">
            <ImageIcon size={40} className="mx-auto mb-3 opacity-40" aria-hidden />
            <p className="mb-2 text-base text-fg">{t('welcome.title')}</p>
            {body}
            {props.children}
        </div>
    );
}

function TipButton(props: { label: string; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className="rounded border border-default p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
        >
            {props.children}
        </button>
    );
}
