import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useSession } from '@/api/hooks';

interface GpuInfo {
    id: number;
    name: string;
    temperature: number;
    utilization_gpu: number;
    utilization_memory: number;
    total_memory: number;
    free_memory: number;
    used_memory: number;
}

interface ResourceInfo {
    cpu: { usage: number; cores: number };
    system_ram: { total: number; used: number; free: number };
    gpus: Record<string, GpuInfo>;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) {
        return '—';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function ServerInfoPage() {
    const session = useSession();
    const resources = useQuery({
        queryKey: ['server-resources'],
        queryFn: () => api.post<ResourceInfo>('GetServerResourceInfo'),
        refetchInterval: 3000
    });

    const gpus = Object.values(resources.data?.gpus ?? {});
    const ram = resources.data?.system_ram;

    return (
        <div className="h-full overflow-y-auto p-4">
            <div className="grid max-w-4xl gap-3">
                <Panel title="Instance">
                    <Row label="User" value={session.data?.user_id ?? '—'} />
                    <Row label="Server build" value={session.data?.version ?? '—'} />
                    <Row label="Permissions granted" value={String(session.data?.permissions.length ?? 0)} />
                </Panel>

                <Panel title="CPU">
                    {resources.data ? (
                        <>
                            <Meter
                                label={`Usage${resources.data.cpu.cores ? ` (${resources.data.cpu.cores} cores)` : ''}`}
                                percent={resources.data.cpu.usage * 100}
                                text={`${(resources.data.cpu.usage * 100).toFixed(0)}%`}
                            />
                            {ram && (
                                <Meter
                                    label="System RAM"
                                    percent={ram.total ? (ram.used / ram.total) * 100 : 0}
                                    text={`${formatBytes(ram.used)} / ${formatBytes(ram.total)}`}
                                />
                            )}
                        </>
                    ) : (
                        <p className="text-sm text-fg-soft">Loading…</p>
                    )}
                </Panel>

                <Panel title={`GPUs${gpus.length ? ` (${gpus.length})` : ''}`}>
                    {resources.isPending ? (
                        <p className="text-sm text-fg-soft">Loading…</p>
                    ) : gpus.length === 0 ? (
                        <p className="text-sm text-fg-soft">
                            No NVIDIA GPUs detected. AMD and Apple hardware are not reported here.
                        </p>
                    ) : (
                        gpus.map(gpu => (
                            <div key={gpu.id} className="mb-3 last:mb-0">
                                <p className="mb-1 text-sm text-fg">
                                    <span className="text-fg-soft">#{gpu.id}</span> {gpu.name}
                                    {gpu.temperature > 0 && (
                                        <span className="ml-2 text-xs text-fg-soft">{gpu.temperature}°C</span>
                                    )}
                                </p>
                                <Meter
                                    label="Utilization"
                                    percent={gpu.utilization_gpu}
                                    text={`${gpu.utilization_gpu}%`}
                                />
                                <Meter
                                    label="VRAM"
                                    percent={gpu.total_memory ? (gpu.used_memory / gpu.total_memory) * 100 : 0}
                                    text={`${formatBytes(gpu.used_memory)} / ${formatBytes(gpu.total_memory)}`}
                                />
                            </div>
                        ))
                    )}
                </Panel>
            </div>
        </div>
    );
}

function Panel(props: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-default bg-surface p-4">
            <h2 className="mb-2 text-sm font-medium text-fg-strong">{props.title}</h2>
            {props.children}
        </section>
    );
}

function Row(props: { label: string; value: string }) {
    return (
        <div className="flex gap-3 py-0.5 text-sm">
            <span className="w-44 shrink-0 text-fg-soft">{props.label}</span>
            <span className="min-w-0 flex-1 break-words text-fg">{props.value}</span>
        </div>
    );
}

function Meter(props: { label: string; percent: number; text: string }) {
    const pct = Math.min(100, Math.max(0, props.percent));
    return (
        <div className="mb-1.5 last:mb-0">
            <div className="mb-0.5 flex items-baseline gap-2 text-xs">
                <span className="w-44 shrink-0 text-fg-soft">{props.label}</span>
                <span className="text-fg tabular-nums">{props.text}</span>
            </div>
            <div className="ml-44 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--sw-surface-sunken)' }}>
                <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                        width: `${pct}%`,
                        background: pct > 90 ? 'var(--backend-errored)' : 'var(--emphasis)'
                    }}
                />
            </div>
        </div>
    );
}
