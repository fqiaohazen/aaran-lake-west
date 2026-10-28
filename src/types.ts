export type MetricLayer = 'pressure' | 'fireflow' | 'waterage';

export type PressureSubMetric = 'p68' | 'pAvg' | 'head68';
export type WaterAgeSubMetric = 'age24' | 'age336' | 'age68' | 'netAge';

export interface NetworkBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  centerLat: number;
  centerLng: number;
}

export interface NetworkNodesColumns {
  id: string[];
  type: number[]; // 0 = Junction, 1 = Tank, 2 = Reservoir
  lat: number[];
  lng: number[];
  x: number[];
  y: number[];
  elev: number[];
  dem68: number[];
  avgDem: number[];
  head68: number[];
  p68: number[];
  pAvg: number[];
  ff: number[];
  resP: number[];
  age24: number[];
  age68: number[];
  age336: number[];
  ageMax: number[];
  netAge: number[];
}

export interface NetworkNodesPayload {
  count: number;
  bounds: NetworkBounds;
  columns: NetworkNodesColumns;
}

export interface NetworkPipesPayload {
  count: number;
  id: string[];
  u: number[];
  v: number[];
  diam: number[];
  mat: string[];
  length: number[];
  rough: number[];
}

export function formatPipeMaterial(code: string | undefined): string {
  const m = (code || '').trim().toUpperCase();
  switch (m) {
    case 'C900':
      return 'C900 (PVC)';
    case 'PVC':
      return 'PVC (Polyvinyl Chloride)';
    case 'DI':
      return 'DI (Ductile Iron)';
    case 'AC':
      return 'AC (Asbestos Cement)';
    case 'CI':
      return 'CI (Cast Iron)';
    case 'SDR21':
      return 'SDR21 (PVC)';
    case 'SDR26':
      return 'SDR26 (PVC)';
    case 'STEEL':
    case 'ST':
      return 'Steel';
    case 'HDPE':
      return 'HDPE';
    case 'CONC':
      return 'CONC (Concrete)';
    case 'WI':
      return 'WI (Wrought Iron)';
    case 'GI':
    case 'GS':
      return 'GI (Galvanized Iron)';
    case 'BRASS':
      return 'Brass';
    default:
      return code || 'Unspecified';
  }
}

export interface BinSpec {
  id: string;
  label: string;
  sublabel: string;
  color: string;
  min: number;
  max: number;
}

export interface LayerConfig {
  id: MetricLayer;
  title: string;
  unit: string;
  subtitle: string;
  bins: BinSpec[];
}

export const LAYER_CONFIGS: Record<string, LayerConfig> = {
  pressure_p68: {
    id: 'pressure',
    title: 'Static Pressure (Peak Hr 68:00)',
    unit: 'psi',
    subtitle: 'Peak Hour 68:00 Hydraulic Grade & Nodal Pressure',
    bins: [
      { id: 'p0', label: '< 20 psi', sublabel: 'Sub-minimum (<20 psi)', color: '#EF4444', min: -Infinity, max: 20 },
      { id: 'p1', label: '20 – 40 psi', sublabel: 'Low operating range', color: '#F97316', min: 20, max: 40 },
      { id: 'p2', label: '40 – 60 psi', sublabel: 'Moderate operating', color: '#EAB308', min: 40, max: 60 },
      { id: 'p3', label: '60 – 75 psi', sublabel: 'Standard service zone', color: '#22C55E', min: 60, max: 75 },
      { id: 'p4', label: '75 – 90 psi', sublabel: 'High pressure zone', color: '#06B6D4', min: 75, max: 90 },
      { id: 'p5', label: '≥ 90 psi', sublabel: 'Elevated / booster head', color: '#3B82F6', min: 90, max: Infinity },
    ],
  },
  pressure_pAvg: {
    id: 'pressure',
    title: 'Mean Operating Pressure (336-Hr)',
    unit: 'psi',
    subtitle: '14-Day Extended Period Simulation Average Pressure',
    bins: [
      { id: 'pa0', label: '< 20 psi', sublabel: 'Sub-minimum (<20 psi)', color: '#EF4444', min: -Infinity, max: 20 },
      { id: 'pa1', label: '20 – 40 psi', sublabel: 'Low operating range', color: '#F97316', min: 20, max: 40 },
      { id: 'pa2', label: '40 – 60 psi', sublabel: 'Moderate operating', color: '#EAB308', min: 40, max: 60 },
      { id: 'pa3', label: '60 – 75 psi', sublabel: 'Standard service zone', color: '#22C55E', min: 60, max: 75 },
      { id: 'pa4', label: '75 – 90 psi', sublabel: 'High pressure zone', color: '#06B6D4', min: 75, max: 90 },
      { id: 'pa5', label: '≥ 90 psi', sublabel: 'Elevated / booster head', color: '#3B82F6', min: 90, max: Infinity },
    ],
  },
  pressure_head68: {
    id: 'pressure',
    title: 'Hydraulic Grade Line (Hr 68:00)',
    unit: 'ft',
    subtitle: 'Total Piezometric Head (Elevation + Pressure Head)',
    bins: [
      { id: 'h0', label: '< 235 ft', sublabel: 'Low HGL zone', color: '#3B82F6', min: -Infinity, max: 235 },
      { id: 'h1', label: '235 – 245 ft', sublabel: 'Lower main zone', color: '#06B6D4', min: 235, max: 245 },
      { id: 'h2', label: '245 – 255 ft', sublabel: 'Central HGL gradient', color: '#22C55E', min: 245, max: 255 },
      { id: 'h3', label: '255 – 310 ft', sublabel: 'Upper main gradient', color: '#EAB308', min: 255, max: 310 },
      { id: 'h4', label: '310 – 345 ft', sublabel: 'High pressure zone', color: '#F97316', min: 310, max: 345 },
      { id: 'h5', label: '≥ 345 ft', sublabel: 'Western high elevation zone', color: '#EF4444', min: 345, max: Infinity },
    ],
  },
  fireflow: {
    id: 'fireflow',
    title: 'Available Fire Flow (@ 20 psi)',
    unit: 'gpm',
    subtitle: 'Peak Demand Hour 68:00 — Min 20 psi Residual Criterion',
    bins: [
      { id: 'ff0', label: '< 500 gpm', sublabel: 'Deficient (<500 gpm)', color: '#EF4444', min: -Infinity, max: 500 },
      { id: 'ff1', label: '500 – 1,000 gpm', sublabel: 'Light residential', color: '#F97316', min: 500, max: 1000 },
      { id: 'ff2', label: '1,000 – 1,500 gpm', sublabel: 'Standard residential', color: '#EAB308', min: 1000, max: 1500 },
      { id: 'ff3', label: '1,500 – 2,500 gpm', sublabel: 'Commercial / municipal', color: '#22C55E', min: 1500, max: 2500 },
      { id: 'ff4', label: '2,500 – 3,500 gpm', sublabel: 'High capacity main', color: '#06B6D4', min: 2500, max: 3500 },
      { id: 'ff5', label: '≥ 3,500 gpm', sublabel: 'Transmission trunk capacity', color: '#3B82F6', min: 3500, max: Infinity },
    ],
  },
  waterage_age24: {
    id: 'waterage',
    title: 'Water Age (Final Day 24-Hr Avg)',
    unit: 'hrs',
    subtitle: 'Diurnal Equilibrium Mean Age (Hours 312–336, incl. 30h WTP base)',
    bins: [
      { id: 'wa0', label: '30 – 45 hrs', sublabel: 'Fresh near WTP (<15h travel)', color: '#06B6D4', min: -Infinity, max: 45 },
      { id: 'wa1', label: '45 – 60 hrs', sublabel: 'Active transmission (15–30h)', color: '#22C55E', min: 45, max: 60 },
      { id: 'wa2', label: '60 – 90 hrs', sublabel: 'Moderate age (2.5–3.75 days)', color: '#84CC16', min: 60, max: 90 },
      { id: 'wa3', label: '90 – 150 hrs', sublabel: 'Tank cycling zone (3.75–6.25d)', color: '#EAB308', min: 90, max: 150 },
      { id: 'wa4', label: '150 – 240 hrs', sublabel: 'High residence (6.25–10 days)', color: '#F97316', min: 150, max: 240 },
      { id: 'wa5', label: '≥ 240 hrs', sublabel: 'Stagnant / dead-end (10–14+ days)', color: '#EF4444', min: 240, max: Infinity },
    ],
  },
  waterage_age336: {
    id: 'waterage',
    title: 'Water Age (Final Hour 336:00)',
    unit: 'hrs',
    subtitle: 'End of 14-Day Simulation Snapshot (Hour 336:00)',
    bins: [
      { id: 'wf0', label: '30 – 45 hrs', sublabel: 'Fresh near WTP (<15h travel)', color: '#06B6D4', min: -Infinity, max: 45 },
      { id: 'wf1', label: '45 – 60 hrs', sublabel: 'Active transmission (15–30h)', color: '#22C55E', min: 45, max: 60 },
      { id: 'wf2', label: '60 – 90 hrs', sublabel: 'Moderate age (2.5–3.75 days)', color: '#84CC16', min: 60, max: 90 },
      { id: 'wf3', label: '90 – 150 hrs', sublabel: 'Tank cycling zone (3.75–6.25d)', color: '#EAB308', min: 90, max: 150 },
      { id: 'wf4', label: '150 – 240 hrs', sublabel: 'High residence (6.25–10 days)', color: '#F97316', min: 150, max: 240 },
      { id: 'wf5', label: '≥ 240 hrs', sublabel: 'Stagnant / dead-end (10–14+ days)', color: '#EF4444', min: 240, max: Infinity },
    ],
  },
  waterage_age68: {
    id: 'waterage',
    title: 'Water Age (Peak Demand Hr 68:00)',
    unit: 'hrs',
    subtitle: 'Water Age Snapshot at Peak Demand Hour 68:00',
    bins: [
      { id: 'w68_0', label: '< 35 hrs', sublabel: 'Fresh near WTP', color: '#06B6D4', min: -Infinity, max: 35 },
      { id: 'w68_1', label: '35 – 45 hrs', sublabel: 'Primary distribution', color: '#22C55E', min: 35, max: 45 },
      { id: 'w68_2', label: '45 – 55 hrs', sublabel: 'Secondary distribution', color: '#84CC16', min: 45, max: 55 },
      { id: 'w68_3', label: '55 – 68 hrs', sublabel: 'Peripheral mains', color: '#EAB308', min: 55, max: 68 },
      { id: 'w68_4', label: '68 – 85 hrs', sublabel: 'Storage-fed zone', color: '#F97316', min: 68, max: 85 },
      { id: 'w68_5', label: '≥ 85 hrs', sublabel: 'Initial tank residence', color: '#EF4444', min: 85, max: Infinity },
    ],
  },
  waterage_netAge: {
    id: 'waterage',
    title: 'Net Travel Time from WTP',
    unit: 'hrs',
    subtitle: 'Distribution System Travel Time (Final Day Age minus 30h WTP Base)',
    bins: [
      { id: 'wn0', label: '< 15 hrs', sublabel: 'Direct main feed (<15h)', color: '#06B6D4', min: -Infinity, max: 15 },
      { id: 'wn1', label: '15 – 30 hrs', sublabel: '1-day distribution travel', color: '#22C55E', min: 15, max: 30 },
      { id: 'wn2', label: '30 – 60 hrs', sublabel: '1–2.5 days net travel', color: '#84CC16', min: 30, max: 60 },
      { id: 'wn3', label: '60 – 120 hrs', sublabel: '2.5–5 days (tank mixing)', color: '#EAB308', min: 60, max: 120 },
      { id: 'wn4', label: '120 – 210 hrs', sublabel: '5–8.75 days travel', color: '#F97316', min: 120, max: 210 },
      { id: 'wn5', label: '≥ 210 hrs', sublabel: 'Dead-end stagnation (>8.75d)', color: '#EF4444', min: 210, max: Infinity },
    ],
  },
};

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
