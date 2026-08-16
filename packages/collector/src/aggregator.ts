export interface RawMetrics {
  cpuDatapoints: number[];
  memDatapoints: number[];
  netInBytes: number[];
  netOutBytes: number[];
}

export interface AggregatedMetrics {
  cpuAvg: number;
  cpuP95: number;
  netInMb: number;
  netOutMb: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * (p / 100));
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

const BYTES_PER_MB = 1024 * 1024;

export function aggregate(raw: RawMetrics): AggregatedMetrics {
  return {
    cpuAvg: parseFloat(average(raw.cpuDatapoints).toFixed(2)),
    cpuP95: parseFloat(percentile(raw.cpuDatapoints, 95).toFixed(2)),
    netInMb: parseFloat((raw.netInBytes.reduce((s, b) => s + b, 0) / BYTES_PER_MB).toFixed(4)),
    netOutMb: parseFloat((raw.netOutBytes.reduce((s, b) => s + b, 0) / BYTES_PER_MB).toFixed(4)),
  };
}
