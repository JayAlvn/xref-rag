import { useEffect, useState } from 'react';

export type MachineSpecs = {
  cpu: string;
  cores: number;
  threads: number;
  ram_total_gb: number;
  gpu: string | null;
  vram_total_mb: number | null;
  os: string;
};

export type GpuStats = {
  name: string;
  util: number;
  vram_used_mb: number;
  vram_total_mb: number;
  temp_c: number;
};

export type CpuStats = {
  util: number;
  // null when the machine exposes no CPU temperature sensor (common on
  // Windows and in VMs); missing entirely from an older backend.
  temp_c?: number | null;
  ram_used_gb: number;
  ram_total_gb: number;
};

export type ModelStats = {
  loaded: boolean;
  name?: string;
  gpu_percent?: number;
  size_gb?: number;
};

export type MachineStats = {
  specs: MachineSpecs;
  gpu: GpuStats | null;
  cpu: CpuStats;
  model: ModelStats | null;
};

/** Poll the backend's hardware readings: fast during a query, slow when idle. */
export function useMachineStats(busy: boolean): MachineStats | null {
  const [stats, setStats] = useState<MachineStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch('http://localhost:8000/stats');
        if (!res.ok) return;
        const data = await res.json();
        // Without this guard a response landing after unmount sets state on a
        // component that no longer exists.
        if (!cancelled) setStats(data);
      } catch {
        /* backend down, or /stats not added yet — the panel just stays quiet */
      }
    };

    tick();
    const id = setInterval(tick, busy ? 500 : 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [busy]);

  return stats;
}
