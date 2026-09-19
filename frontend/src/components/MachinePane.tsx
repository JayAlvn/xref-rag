import type { MachineStats } from '../lib/useMachineStats';

const GREEN = '#22c55e';
const BLUE = '#3b82f6';
const AMBER = '#f59e0b';
const RED = '#ef4444';

function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      className="h-1.5 w-full rounded-full overflow-hidden"
      style={{ backgroundColor: 'var(--card-bg)' }}
    >
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }}
      />
    </div>
  );
}

/* Green when cool, amber when warm, red when hot. */
function heatColor(celsius: number): string {
  if (celsius >= 80) return RED;
  if (celsius >= 65) return AMBER;
  return GREEN;
}

/* One device as grid cells: label, meter, load and temperature, with its memory underneath. */
function DeviceRow({ label, pct, color, tempC, memory }: {
  label: string;
  pct: number;
  color: string;
  tempC?: number | null;
  memory: string;
}) {
  let tempText = '';
  let tempColor = 'var(--text-muted)';
  if (tempC !== null && tempC !== undefined) {
    tempText = `${Math.round(tempC)}°C`;
    tempColor = heatColor(tempC);
  }

  return (
    <>
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <Meter pct={pct} color={color} />
      <span className="text-right text-sm font-semibold tabular-nums" style={{ color }}>
        {Math.round(pct)}%
      </span>
      <span className="text-right text-xs font-semibold tabular-nums" style={{ color: tempColor }}>
        {tempText}
      </span>
      <span className="col-span-3 col-start-2 mb-1.5 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {memory}
      </span>
    </>
  );
}

export function MachinePane({
  machine,
}: {
  machine: MachineStats | null;
}) {
  if (!machine) return null;

  const { gpu, cpu, model } = machine;

  return (
    <div>
      <h3
        className="text-[11px] font-semibold tracking-widest uppercase mb-3"
        style={{ color: 'var(--text-muted)' }}
      >
        Machine
      </h3>

      {/* One grid for both devices, so their meters, loads and temperatures line up. */}
      <div className="mb-3 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-0.5">
        {gpu && (
          <DeviceRow
            label="GPU"
            pct={gpu.util}
            color={GREEN}
            tempC={gpu.temp_c}
            memory={`${(gpu.vram_used_mb / 1024).toFixed(1)} / ${(gpu.vram_total_mb / 1024).toFixed(1)} GB VRAM`}
          />
        )}
        <DeviceRow
          label="CPU"
          pct={cpu.util}
          color={BLUE}
          tempC={cpu.temp_c}
          memory={`${cpu.ram_used_gb} / ${cpu.ram_total_gb} GB RAM`}
        />
      </div>

      {/* Model residency — the real explanation for generation speed. */}
      {model && (
        <div
          className="rounded-lg p-2.5 text-xs"
          style={{
            backgroundColor: 'var(--card-bg)',
            border: `1px solid ${model.loaded ? 'var(--border-color)' : AMBER}`,
          }}
        >
          {model.loaded ? (
            <>
              <span className="font-semibold" style={{ color: 'var(--text-main)' }}>
                {model.name}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}· {model.size_gb} GB · {model.gpu_percent}% on GPU
              </span>
              {(model.gpu_percent ?? 100) < 100 && (
                <p className="mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {100 - (model.gpu_percent ?? 0)}% of layers offloaded to system RAM —
                  generation throughput is bound by CPU memory bandwidth rather than the GPU.
                </p>
              )}
            </>
          ) : (
            <span style={{ color: AMBER }}>
              Model not loaded — the next query spends ~10s reloading it first.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
