import { Construction } from 'lucide-react';
import type { Destination } from '@/nav/destinations';

/** Honest placeholder for a destination that is routed but not yet built.
 *  Says which phase delivers it rather than pretending to be an empty screen. */
export function Placeholder(props: { destination: Destination; phase: string; summary: string }) {
    const Icon = props.destination.icon;
    return (
        <div className="p-8 max-w-2xl">
            <div className="flex items-center gap-2 mb-1">
                <Icon size={20} className="text-fg-soft" aria-hidden />
                <h1 className="text-xl font-semibold text-fg-strong">{props.destination.label}</h1>
            </div>
            <p className="text-fg-soft mb-6">{props.summary}</p>
            <div className="flex items-start gap-3 rounded-lg border border-default bg-surface p-4">
                <Construction size={18} className="mt-0.5 shrink-0 text-fg-soft" aria-hidden />
                <div>
                    <p className="text-fg">Not built yet — arriving in {props.phase}.</p>
                    <p className="text-sm text-fg-soft mt-1">
                        This screen's functionality is still available in the existing interface at{' '}
                        <a href="/Text2Image" className="underline" style={{ color: 'var(--emphasis)' }}>
                            /Text2Image
                        </a>
                        .
                    </p>
                </div>
            </div>
        </div>
    );
}
