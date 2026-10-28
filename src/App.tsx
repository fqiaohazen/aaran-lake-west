import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { APIProvider, Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import {
  MetricLayer,
  PressureSubMetric,
  WaterAgeSubMetric,
  NetworkNodesPayload,
  NetworkPipesPayload,
  LAYER_CONFIGS,
  LayerConfig,
  formatPipeMaterial,
} from './types';
import { DraggableLegend } from './DraggableLegend';
import { NetworkOverlay, CameraState } from './NetworkOverlay';
import { StreetViewPanel, StreetViewState } from './StreetViewPanel';

const RAW_ENV_KEY = (
  (typeof __AMPLIFY_GOOGLE_MAPS_API_KEY__ !== 'undefined' && __AMPLIFY_GOOGLE_MAPS_API_KEY__) ||
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) ||
  ''
).trim();

const RAW_ENV_MAP_ID = (
  (typeof __AMPLIFY_GOOGLE_MAPS_MAP_ID__ !== 'undefined' && __AMPLIFY_GOOGLE_MAPS_MAP_ID__) ||
  (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) ||
  'DEMO_MAP_ID'
).trim();

const ENV_API_KEY = RAW_ENV_KEY;
const ENV_MAP_ID = RAW_ENV_MAP_ID.startsWith('AIza') ? 'DEMO_MAP_ID' : RAW_ENV_MAP_ID || 'DEMO_MAP_ID';

// Arran Lake West Dam on Lakeridge Drive (at Lake Trail Dr / Node F121380 & SV132253)
const ARRAN_LAKE_DAM_VIEW: CameraState = {
  lat: 35.00925,
  lng: -78.98905,
  zoom: 17.5,
  tilt: 0,
  heading: 0,
};

interface MapCameraSyncProps {
  camera: CameraState;
  bounds: NetworkNodesPayload['bounds'];
  onCameraChange: (cam: CameraState) => void;
  fitTrigger: number;
}

const GoogleMapCameraController: React.FC<MapCameraSyncProps> = ({
  bounds,
  onCameraChange,
  fitTrigger,
}) => {
  const map = useMap();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      map.moveCamera({
        center: { lat: ARRAN_LAKE_DAM_VIEW.lat, lng: ARRAN_LAKE_DAM_VIEW.lng },
        zoom: ARRAN_LAKE_DAM_VIEW.zoom,
        tilt: 0,
        heading: 0,
      });
      onCameraChange({ ...ARRAN_LAKE_DAM_VIEW });
      return;
    }
    if (fitTrigger > 0) {
      const latLngBounds = new window.google.maps.LatLngBounds(
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east }
      );
      map.fitBounds(latLngBounds, 36);
      window.setTimeout(() => {
        map.moveCamera({ tilt: 0, heading: 0 });
        const c = map.getCenter();
        onCameraChange({
          lat: c ? c.lat() : bounds.centerLat,
          lng: c ? c.lng() : bounds.centerLng,
          zoom: map.getZoom() ?? 11.5,
          tilt: 0,
          heading: 0,
        });
      }, 120);
    }
  }, [map, bounds, fitTrigger, onCameraChange]);

  return null;
};

export const App: React.FC = () => {
  const [nodes, setNodes] = useState<NetworkNodesPayload | null>(null);
  const [pipes, setPipes] = useState<NetworkPipesPayload | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  // Active layer & sub-metric
  const [activeLayer, setActiveLayer] = useState<MetricLayer>('fireflow');
  const [pressureSub, setPressureSub] = useState<PressureSubMetric>('p68');
  const [waterAgeSub, setWaterAgeSub] = useState<WaterAgeSubMetric>('age24');

  // Map overlays (initial node size shrunk by 40%: 2.5 -> 1.5)
  const [showPipes, setShowPipes] = useState<boolean>(true);
  const [showFacilities, setShowFacilities] = useState<boolean>(true);
  const [pointSize, setPointSize] = useState<number>(1.5);
  const [hiddenBins, setHiddenBins] = useState<Set<number>>(new Set());

  // Selection & Hover (Nodes & Pipes)
  const [selectedNodeIdx, setSelectedNodeIdx] = useState<number | null>(null);
  const [hoveredNodeIdx, setHoveredNodeIdx] = useState<number | null>(null);
  const [selectedPipeIdx, setSelectedPipeIdx] = useState<number | null>(null);
  const [hoveredPipeIdx, setHoveredPipeIdx] = useState<number | null>(null);
  const [hoverScreenPos, setHoverScreenPos] = useState<{ x: number; y: number } | null>(null);

  // Menu popup state (closed by default; opens when Menu button is clicked)
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState<boolean>(false);

  // Camera state — starts at Arran Lake West Dam on Lakeridge Drive, flat (tilt: 0) and North (heading: 0)
  const [camera, setCamera] = useState<CameraState>({ ...ARRAN_LAKE_DAM_VIEW });
  const [fitTrigger, setFitTrigger] = useState<number>(0);

  // Google Street View split-screen state & Pegman drag state
  const [streetView, setStreetView] = useState<StreetViewState>({
    active: false,
    lat: ARRAN_LAKE_DAM_VIEW.lat,
    lng: ARRAN_LAKE_DAM_VIEW.lng,
    heading: 115,
    pitch: 0,
    description: '2037 Lakeridge Dr, Fayetteville, North Carolina',
    panoId: '',
  });
  const [pegmanDrag, setPegmanDrag] = useState<{
    dragging: boolean;
    startX: number;
    startY: number;
    clientX: number;
    clientY: number;
    moved: boolean;
  }>({
    dragging: false,
    startX: 0,
    startY: 0,
    clientX: 0,
    clientY: 0,
    moved: false,
  });
  const screenToLatLngRef = useRef<
    ((clientX: number, clientY: number) => { lat: number; lng: number } | null) | null
  >(null);

  const handleUpdateStreetView = useCallback((next: Partial<StreetViewState>) => {
    setStreetView((prev) => ({ ...prev, ...next }));
  }, []);

  // Google Maps API key & Basemap mode
  const [storedApiKey, setStoredApiKey] = useState<string>(() => {
    return localStorage.getItem('FAY_GOOGLE_MAPS_API_KEY') || ENV_API_KEY;
  });
  const [apiKeyInput, setApiKeyInput] = useState<string>(storedApiKey);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [gmAuthFailed, setGmAuthFailed] = useState<boolean>(false);
  const [basemapStyle, setBasemapStyle] = useState<'dark' | 'satellite' | 'light'>('light');
  const [preferGoogleMaps, setPreferGoogleMaps] = useState<boolean>(true);

  const gmapInstanceRef = useRef<google.maps.Map | null>(null);
  const spinIntervalRef = useRef<number | null>(null);

  // Listen for Google Maps auth failure so we never leave a broken map
  useEffect(() => {
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      setGmAuthFailed(true);
    };
  }, []);

  const useGoogleMaps = Boolean(preferGoogleMaps && storedApiKey.trim() && !gmAuthFailed);

  // Load node and pipe datasets
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/data/network-nodes.json').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading network-nodes.json`);
        return r.json();
      }),
      fetch('/data/network-pipes.json').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading network-pipes.json`);
        return r.json();
      }),
    ])
      .then(([nodesData, pipesData]: [NetworkNodesPayload, NetworkPipesPayload]) => {
        if (cancelled) return;
        setNodes(nodesData);
        setPipes(pipesData);
        setCamera({ ...ARRAN_LAKE_DAM_VIEW });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadingError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset hidden bins when switching metric
  const configKey = useMemo(() => {
    if (activeLayer === 'pressure') return `pressure_${pressureSub}`;
    if (activeLayer === 'waterage') return `waterage_${waterAgeSub}`;
    return 'fireflow';
  }, [activeLayer, pressureSub, waterAgeSub]);

  const currentConfig: LayerConfig = LAYER_CONFIGS[configKey] || LAYER_CONFIGS.fireflow;

  useEffect(() => {
    setHiddenBins(new Set());
  }, [configKey]);

  // Compute active metric Float32Array, bin assignments, and summary statistics
  const { nodeValues, nodeBins, binCounts, totalJunctions, stats } = useMemo(() => {
    if (!nodes) {
      return {
        nodeValues: new Float32Array(0),
        nodeBins: new Uint8Array(0),
        binCounts: [],
        totalJunctions: 0,
        stats: { min: 0, p25: 0, median: 0, mean: 0, p90: 0, max: 0 },
      };
    }

    const count = nodes.count;
    const vals = new Float32Array(count);
    const bins = new Uint8Array(count);
    const counts = new Array(currentConfig.bins.length).fill(0);
    const cols = nodes.columns;

    let srcArr: number[];
    if (activeLayer === 'pressure') {
      srcArr = cols[pressureSub];
    } else if (activeLayer === 'waterage') {
      srcArr = cols[waterAgeSub];
    } else {
      srcArr = cols.ff;
    }

    const juncVals: number[] = [];
    let sum = 0;
    const binSpecs = currentConfig.bins;
    const nBins = binSpecs.length;

    for (let i = 0; i < count; i++) {
      const v = srcArr[i];
      vals[i] = v;
      let bIdx = nBins - 1;
      for (let b = 0; b < nBins; b++) {
        if (v >= binSpecs[b].min && v < binSpecs[b].max) {
          bIdx = b;
          break;
        }
      }
      bins[i] = bIdx;
      if (cols.type[i] === 0) {
        counts[bIdx]++;
        juncVals.push(v);
        sum += v;
      }
    }

    juncVals.sort((a, b) => a - b);
    const nJ = juncVals.length;
    const pct = (p: number) =>
      nJ > 0 ? juncVals[Math.min(nJ - 1, Math.floor(nJ * p))] : 0;

    return {
      nodeValues: vals,
      nodeBins: bins,
      binCounts: counts,
      totalJunctions: nJ,
      stats: {
        min: nJ > 0 ? juncVals[0] : 0,
        p25: pct(0.25),
        median: pct(0.5),
        mean: nJ > 0 ? sum / nJ : 0,
        p90: pct(0.9),
        max: nJ > 0 ? juncVals[nJ - 1] : 0,
      },
    };
  }, [nodes, activeLayer, pressureSub, waterAgeSub, currentConfig]);

  // Extract 7 key storage & WTP facilities for quick jump
  const facilities = useMemo(() => {
    if (!nodes) return [];
    const list: { idx: number; id: string; type: number }[] = [];
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.columns.type[i] !== 0) {
        list.push({
          idx: i,
          id: nodes.columns.id[i],
          type: nodes.columns.type[i],
        });
      }
    }
    return list;
  }, [nodes]);

  // Search suggestions
  const searchResults = useMemo(() => {
    if (!nodes || !searchQuery.trim()) return [];
    const q = searchQuery.trim().toUpperCase();
    const matches: number[] = [];
    const ids = nodes.columns.id;
    for (let i = 0; i < nodes.count; i++) {
      if (ids[i].toUpperCase().includes(q)) {
        matches.push(i);
        if (matches.length >= 12) break;
      }
    }
    return matches;
  }, [nodes, searchQuery]);

  const applyCamera = useCallback(
    (next: Partial<CameraState>) => {
      setCamera((prev) => {
        const merged: CameraState = {
          lat: next.lat ?? prev.lat,
          lng: next.lng ?? prev.lng,
          zoom: next.zoom ?? prev.zoom,
          tilt: next.tilt !== undefined ? Math.max(0, Math.min(67.5, next.tilt)) : prev.tilt,
          heading:
            next.heading !== undefined
              ? (((next.heading % 360) + 360) % 360)
              : prev.heading,
        };
        if (useGoogleMaps && gmapInstanceRef.current) {
          gmapInstanceRef.current.moveCamera({
            center: { lat: merged.lat, lng: merged.lng },
            zoom: merged.zoom,
            tilt: merged.tilt,
            heading: merged.heading,
          });
        }
        return merged;
      });
    },
    [useGoogleMaps]
  );

  const flyToNode = useCallback(
    (idx: number) => {
      if (!nodes) return;
      setSelectedNodeIdx(idx);
      applyCamera({
        lat: nodes.columns.lat[idx],
        lng: nodes.columns.lng[idx],
        zoom: Math.max(camera.zoom, 15.2),
      });
      setSearchOpen(false);
    },
    [nodes, camera.zoom, applyCamera]
  );

  const resetFullNetwork = useCallback(() => {
    if (!nodes) return;
    setCamera({
      lat: nodes.bounds.centerLat,
      lng: nodes.bounds.centerLng,
      zoom: 11.4,
      tilt: 0,
      heading: 0,
    });
    setFitTrigger((t) => t + 1);
  }, [nodes]);

  // Hold-to-spin buttons
  const startSpin = (dir: number) => {
    stopSpin();
    const step = () => {
      applyCamera({ heading: camera.heading + dir * 2.5 });
    };
    step();
    spinIntervalRef.current = window.setInterval(() => {
      setCamera((prev) => {
        const nextH = (((prev.heading + dir * 2.5) % 360) + 360) % 360;
        if (useGoogleMaps && gmapInstanceRef.current) {
          gmapInstanceRef.current.moveCamera({ heading: nextH });
        }
        return { ...prev, heading: nextH };
      });
    }, 30);
  };

  const stopSpin = () => {
    if (spinIntervalRef.current !== null) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopSpin();
  }, []);

  // Global mouse/touch listeners for dragging the bottom-right Pegman onto the map
  useEffect(() => {
    if (!pegmanDrag.dragging) return;

    const onMove = (clientX: number, clientY: number) => {
      setPegmanDrag((prev) => {
        const dx = clientX - prev.startX;
        const dy = clientY - prev.startY;
        const moved = prev.moved || Math.hypot(dx, dy) > 6;
        return {
          ...prev,
          clientX,
          clientY,
          moved,
        };
      });
    };

    const onFinish = (clientX: number, clientY: number) => {
      const dx = clientX - pegmanDrag.startX;
      const dy = clientY - pegmanDrag.startY;
      const didMove = pegmanDrag.moved || Math.hypot(dx, dy) > 6;
      let targetLat = camera.lat;
      let targetLng = camera.lng;
      if (didMove && screenToLatLngRef.current) {
        const dropLL = screenToLatLngRef.current(clientX, clientY);
        if (dropLL) {
          targetLat = dropLL.lat;
          targetLng = dropLL.lng;
        }
      }
      setPegmanDrag((prev) => ({
        ...prev,
        dragging: false,
        moved: false,
      }));
      setStreetView((sv) => ({
        ...sv,
        active: true,
        lat: targetLat,
        lng: targetLng,
      }));
      applyCamera({
        lat: targetLat,
        lng: targetLng,
      });
    };

    const handleMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const handleMouseUp = (e: MouseEvent) => onFinish(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      onFinish(t ? t.clientX : pegmanDrag.clientX, t ? t.clientY : pegmanDrag.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    pegmanDrag.dragging,
    pegmanDrag.startX,
    pegmanDrag.startY,
    pegmanDrag.moved,
    pegmanDrag.clientX,
    pegmanDrag.clientY,
    camera.lat,
    camera.lng,
  ]);

  const handleToggleBin = useCallback((binIdx: number) => {
    setHiddenBins((prev) => {
      const next = new Set(prev);
      if (next.has(binIdx)) next.delete(binIdx);
      else next.add(binIdx);
      return next;
    });
  }, []);

  const handleHoverNode = useCallback(
    (idx: number | null, pos: { x: number; y: number } | null) => {
      setHoveredNodeIdx(idx);
      if (idx !== null) {
        setHoverScreenPos(pos);
      } else if (hoveredPipeIdx === null) {
        setHoverScreenPos(null);
      }
    },
    [hoveredPipeIdx]
  );

  const handleHoverPipe = useCallback(
    (idx: number | null, pos: { x: number; y: number } | null) => {
      setHoveredPipeIdx(idx);
      if (idx !== null) {
        setHoverScreenPos(pos);
      } else if (hoveredNodeIdx === null) {
        setHoverScreenPos(null);
      }
    },
    [hoveredNodeIdx]
  );

  // Connected pipes for the currently selected node
  const connectedPipesForSelectedNode = useMemo(() => {
    if (selectedNodeIdx === null || !pipes) return [];
    const list: number[] = [];
    const uArr = pipes.u;
    const vArr = pipes.v;
    for (let i = 0; i < pipes.count; i++) {
      if (uArr[i] === selectedNodeIdx || vArr[i] === selectedNodeIdx) {
        list.push(i);
      }
    }
    return list;
  }, [selectedNodeIdx, pipes]);

  if (loadingError) {
    return (
      <div className="loading-screen">
        <div className="loading-card error">
          <h2>Failed to Load EPANET Model Results</h2>
          <p>{loadingError}</p>
        </div>
      </div>
    );
  }

  if (!nodes) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="spinner" />
          <h2>Loading Fayetteville Water Distribution Model</h2>
          <p>43,754 nodes • 46,055 pipes • Pressure, Fire Flow &amp; 336-Hr Water Age</p>
        </div>
      </div>
    );
  }

  const sel = selectedNodeIdx !== null ? selectedNodeIdx : null;
  const hov = hoveredNodeIdx !== null ? hoveredNodeIdx : null;
  const selPipe = selectedPipeIdx !== null ? selectedPipeIdx : null;
  const hovPipe = hoveredPipeIdx !== null ? hoveredPipeIdx : null;

  return (
    <div className="app-shell">
      {/* FLOATING MENU BUTTON & POPUP PANEL */}
      <div className="menu-launcher-wrap">
        <button
          type="button"
          className={`menu-trigger-btn ${menuOpen ? 'open' : ''}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          title="Open layers & controls menu"
        >
          <span className="menu-icon">{menuOpen ? '✕' : '☰'}</span>
          <span className="menu-btn-label">Menu</span>
          <span className="menu-active-pill">
            <span
              className={`tab-dot ${
                activeLayer === 'pressure'
                  ? 'pressure-dot'
                  : activeLayer === 'fireflow'
                  ? 'fireflow-dot'
                  : 'waterage-dot'
              }`}
            />
            {activeLayer === 'pressure'
              ? 'Pressure'
              : activeLayer === 'fireflow'
              ? 'Fire Flow'
              : 'Water Age'}
          </span>
        </button>

        {menuOpen && (
          <div className="menu-popup-card" role="dialog" aria-label="Map Controls Menu">
            <div className="menu-popup-header">
              <div className="brand-cluster">
                <div className="brand-emblem">EPANET 2.2</div>
                <div>
                  <h1 className="brand-title">Fayetteville Water System</h1>
                  <div className="brand-meta">
                    <span>43,747 Nodes</span>
                    <span>•</span>
                    <span>46,055 Pipes</span>
                    <span>•</span>
                    <span>5 Tanks &amp; 2 WTPs</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="menu-close-btn"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            <div className="menu-section">
              <span className="menu-section-label">Result Layer</span>
              <div className="layer-tabs" role="tablist" aria-label="Hydraulic Result Layers">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLayer === 'pressure'}
                  className={`layer-tab ${activeLayer === 'pressure' ? 'active' : ''}`}
                  onClick={() => setActiveLayer('pressure')}
                >
                  <span className="tab-dot pressure-dot" />
                  Pressure
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLayer === 'fireflow'}
                  className={`layer-tab ${activeLayer === 'fireflow' ? 'active' : ''}`}
                  onClick={() => setActiveLayer('fireflow')}
                >
                  <span className="tab-dot fireflow-dot" />
                  Fire Flow
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLayer === 'waterage'}
                  className={`layer-tab ${activeLayer === 'waterage' ? 'active' : ''}`}
                  onClick={() => setActiveLayer('waterage')}
                >
                  <span className="tab-dot waterage-dot" />
                  Water Age
                </button>
              </div>
            </div>

            {activeLayer === 'pressure' && (
              <div className="menu-section">
                <span className="menu-section-label">Pressure Metric</span>
                <select
                  className="submetric-select full-width"
                  value={pressureSub}
                  onChange={(e) => setPressureSub(e.target.value as PressureSubMetric)}
                  aria-label="Pressure Metric Variant"
                >
                  <option value="p68">Peak Hr 68:00 Pressure (psi)</option>
                  <option value="pAvg">336-Hr Mean Pressure (psi)</option>
                  <option value="head68">Hydraulic Grade Line (ft)</option>
                </select>
              </div>
            )}

            {activeLayer === 'waterage' && (
              <div className="menu-section">
                <span className="menu-section-label">Water Age Metric</span>
                <select
                  className="submetric-select full-width"
                  value={waterAgeSub}
                  onChange={(e) => setWaterAgeSub(e.target.value as WaterAgeSubMetric)}
                  aria-label="Water Age Metric Variant"
                >
                  <option value="age24">Final Day 24-Hr Avg (Hrs 312–336)</option>
                  <option value="age336">Final Hour 336:00 Age (hrs)</option>
                  <option value="age68">Peak Hour 68:00 Age (hrs)</option>
                  <option value="netAge">Net Travel Time from WTP (hrs)</option>
                </select>
              </div>
            )}

            <div className="menu-section">
              <span className="menu-section-label">Map Overlays</span>
              <div className="menu-row">
                <label className="toggle-pill" title="Show/hide 46,055 distribution & trunk pipes">
                  <input
                    type="checkbox"
                    checked={showPipes}
                    onChange={(e) => setShowPipes(e.target.checked)}
                  />
                  <span>Pipes (46k)</span>
                </label>

                <label className="toggle-pill" title="Show/hide Tanks and WTP Reservoirs">
                  <input
                    type="checkbox"
                    checked={showFacilities}
                    onChange={(e) => setShowFacilities(e.target.checked)}
                  />
                  <span>Tanks &amp; WTPs</span>
                </label>
              </div>
            </div>

            <div className="menu-section">
              <span className="menu-section-label">Navigate / Search Node</span>
              <div className="menu-stack">
                <select
                  className="facility-jump-select full-width"
                  value=""
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    if (!Number.isNaN(idx)) {
                      flyToNode(idx);
                      setMenuOpen(false);
                    }
                  }}
                  aria-label="Jump to Tank or WTP"
                >
                  <option value="" disabled>
                    Jump to Tank / WTP…
                  </option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.idx}>
                      {f.type === 2 ? `[WTP] ${f.id}` : `[Tank] ${f.id}`}
                    </option>
                  ))}
                </select>

                <div className="search-box-wrap full-width">
                  <input
                    type="text"
                    className="node-search-input full-width"
                    placeholder="Find Node ID (e.g. F121380)…"
                    value={searchQuery}
                    onFocus={() => setSearchOpen(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchOpen(true);
                    }}
                  />
                  {searchOpen && searchResults.length > 0 && (
                    <div className="search-dropdown">
                      {searchResults.map((idx) => (
                        <button
                          key={nodes.columns.id[idx]}
                          type="button"
                          className="search-item"
                          onClick={() => {
                            setSearchQuery(nodes.columns.id[idx]);
                            flyToNode(idx);
                            setMenuOpen(false);
                          }}
                        >
                          <span className="search-id">{nodes.columns.id[idx]}</span>
                          <span className="search-val">
                            {nodeValues[idx].toFixed(1)} {currentConfig.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="menu-section">
              <span className="menu-section-label">Basemap &amp; Google Maps 3D</span>
              <div className="menu-row">
                <select
                  className="basemap-select flex-1"
                  value={basemapStyle}
                  onChange={(e) =>
                    setBasemapStyle(e.target.value as 'dark' | 'satellite' | 'light')
                  }
                  aria-label="Map Theme"
                >
                  <option value="light">Light Street Map</option>
                  <option value="satellite">Satellite Imagery</option>
                  <option value="dark">Dark Hydrographic</option>
                </select>

                <button
                  type="button"
                  className={`api-key-btn ${useGoogleMaps ? 'connected' : ''}`}
                  onClick={() => setShowKeyModal(true)}
                  title="Configure @vis.gl/react-google-maps API Key"
                >
                  {useGoogleMaps ? 'Google Maps 3D ✓' : 'Google Key'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SPLIT WORKSPACE: LEFT MAP PANE + OPTIONAL RIGHT STREET VIEW PANE */}
      <div className={`workspace-split ${streetView.active ? 'is-split' : ''}`}>
        <main
          className="map-viewport"
          onClick={() => {
            setSearchOpen(false);
            if (menuOpen) setMenuOpen(false);
          }}
        >
          {useGoogleMaps ? (
            <APIProvider apiKey={storedApiKey}>
              <GoogleMap
                mapId={ENV_MAP_ID}
                defaultCenter={{
                  lat: ARRAN_LAKE_DAM_VIEW.lat,
                  lng: ARRAN_LAKE_DAM_VIEW.lng,
                }}
                defaultZoom={ARRAN_LAKE_DAM_VIEW.zoom}
                defaultTilt={0}
                defaultHeading={0}
                mapTypeId={basemapStyle === 'satellite' ? 'hybrid' : 'roadmap'}
                colorScheme={basemapStyle === 'dark' ? 'DARK' : 'LIGHT'}
                gestureHandling="greedy"
                disableDefaultUI={true}
                onCameraChanged={(ev) => {
                  gmapInstanceRef.current = ev.map;
                  setCamera({
                    lat: ev.detail.center.lat,
                    lng: ev.detail.center.lng,
                    zoom: ev.detail.zoom,
                    tilt: ev.detail.tilt,
                    heading: ev.detail.heading,
                  });
                }}
              >
                <GoogleMapCameraController
                  camera={camera}
                  bounds={nodes.bounds}
                  onCameraChange={setCamera}
                  fitTrigger={fitTrigger}
                />
                <NetworkOverlay
                  nodes={nodes}
                  pipes={pipes}
                  nodeValues={nodeValues}
                  nodeBins={nodeBins}
                  config={currentConfig}
                  hiddenBins={hiddenBins}
                  showPipes={showPipes}
                  showFacilities={showFacilities}
                  pointSize={pointSize}
                  selectedNodeIdx={selectedNodeIdx}
                  hoveredNodeIdx={hoveredNodeIdx}
                  selectedPipeIdx={selectedPipeIdx}
                  hoveredPipeIdx={hoveredPipeIdx}
                  onHoverNode={handleHoverNode}
                  onSelectNode={setSelectedNodeIdx}
                  onHoverPipe={handleHoverPipe}
                  onSelectPipe={setSelectedPipeIdx}
                  camera={camera}
                  onCameraChange={setCamera}
                  useGoogleMaps={true}
                  basemapStyle={basemapStyle}
                  streetView={streetView}
                  onUpdateStreetView={handleUpdateStreetView}
                  screenToLatLngRef={screenToLatLngRef}
                />
              </GoogleMap>
            </APIProvider>
          ) : (
            <div className="standalone-map-surface">
              <NetworkOverlay
                nodes={nodes}
                pipes={pipes}
                nodeValues={nodeValues}
                nodeBins={nodeBins}
                config={currentConfig}
                hiddenBins={hiddenBins}
                showPipes={showPipes}
                showFacilities={showFacilities}
                pointSize={pointSize}
                selectedNodeIdx={selectedNodeIdx}
                hoveredNodeIdx={hoveredNodeIdx}
                selectedPipeIdx={selectedPipeIdx}
                hoveredPipeIdx={hoveredPipeIdx}
                onHoverNode={handleHoverNode}
                onSelectNode={setSelectedNodeIdx}
                onHoverPipe={handleHoverPipe}
                onSelectPipe={setSelectedPipeIdx}
                camera={camera}
                onCameraChange={setCamera}
                useGoogleMaps={false}
                basemapStyle={basemapStyle}
                streetView={streetView}
                onUpdateStreetView={handleUpdateStreetView}
                screenToLatLngRef={screenToLatLngRef}
              />
            </div>
          )}

        {/* FLOATING DRAGGABLE LEGEND */}
        <DraggableLegend
          config={currentConfig}
          binCounts={binCounts}
          totalJunctions={totalJunctions}
          hiddenBins={hiddenBins}
          onToggleBin={handleToggleBin}
          onShowAllBins={() => setHiddenBins(new Set())}
          stats={stats}
          pointSize={pointSize}
          onChangePointSize={setPointSize}
        />

        {/* HOVER TOOLTIP FOR NODE OR PIPE */}
        {hov !== null && hoverScreenPos && (
          <div
            className="hover-tooltip"
            style={{
              left: `${Math.min(window.innerWidth - 240, hoverScreenPos.x + 14)}px`,
              top: `${Math.max(56, hoverScreenPos.y - 36)}px`,
            }}
          >
            <div className="hover-id">
              {nodes.columns.type[hov] === 2
                ? `WTP Reservoir ${nodes.columns.id[hov]}`
                : nodes.columns.type[hov] === 1
                ? `Tank ${nodes.columns.id[hov]}`
                : `Node ${nodes.columns.id[hov]}`}
            </div>
            <div className="hover-metric">
              <strong>
                {nodeValues[hov].toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                {currentConfig.unit}
              </strong>{' '}
              <span>({currentConfig.title})</span>
            </div>
          </div>
        )}

        {hov === null && hovPipe !== null && pipes && hoverScreenPos && (
          <div
            className="hover-tooltip"
            style={{
              left: `${Math.min(window.innerWidth - 250, hoverScreenPos.x + 14)}px`,
              top: `${Math.max(56, hoverScreenPos.y - 44)}px`,
            }}
          >
            <div className="hover-id">Pipe {pipes.id[hovPipe]}</div>
            <div className="hover-metric">
              <strong>Diameter: {pipes.diam[hovPipe]} in</strong> •{' '}
              <strong>Material: {formatPipeMaterial(pipes.mat[hovPipe])}</strong>
            </div>
            <div className="hover-sub">
              Length: {pipes.length[hovPipe].toLocaleString()} ft • C-Factor:{' '}
              {pipes.rough[hovPipe]}
            </div>
          </div>
        )}

        {/* SELECTED PIPE INSPECTOR CARD */}
        {selPipe !== null && pipes && (
          <aside className="inspector-card" aria-label="Selected Pipe Details">
            <div className="inspector-header">
              <div>
                <span className="inspector-badge">WATER MAIN PIPE</span>
                <h3 className="inspector-title">Pipe {pipes.id[selPipe]}</h3>
              </div>
              <button
                type="button"
                className="inspector-close"
                onClick={() => setSelectedPipeIdx(null)}
                aria-label="Close pipe details"
              >
                ✕
              </button>
            </div>

            <div className="inspector-pipe-highlights">
              <div className="gauge-box highlight">
                <span className="gauge-name">PIPE DIAMETER</span>
                <span className="gauge-value">
                  {pipes.diam[selPipe]} <small>in</small>
                </span>
                <span className="gauge-sub">
                  {pipes.diam[selPipe] >= 12 ? 'Transmission / Trunk Main' : 'Distribution Main'}
                </span>
              </div>

              <div className="gauge-box highlight">
                <span className="gauge-name">PIPE MATERIAL</span>
                <span className="gauge-value pipe-mat-val">
                  {pipes.mat[selPipe] || 'Unspecified'}
                </span>
                <span className="gauge-sub">
                  {formatPipeMaterial(pipes.mat[selPipe])}
                </span>
              </div>
            </div>

            <div className="inspector-table">
              <div className="insp-row">
                <span>Diameter</span>
                <strong>{pipes.diam[selPipe]} inches</strong>
              </div>
              <div className="insp-row">
                <span>Material</span>
                <strong>{formatPipeMaterial(pipes.mat[selPipe])}</strong>
              </div>
              <div className="insp-row">
                <span>Length</span>
                <strong>{pipes.length[selPipe].toLocaleString()} ft</strong>
              </div>
              <div className="insp-row">
                <span>Hazen-Williams C-Factor</span>
                <strong>{pipes.rough[selPipe]}</strong>
              </div>
              <div className="insp-row">
                <span>Start Node</span>
                <button
                  type="button"
                  className="pipe-node-link"
                  onClick={() => {
                    const uIdx = pipes.u[selPipe];
                    setSelectedPipeIdx(null);
                    setSelectedNodeIdx(uIdx);
                  }}
                >
                  {nodes.columns.id[pipes.u[selPipe]]} →
                </button>
              </div>
              <div className="insp-row">
                <span>End Node</span>
                <button
                  type="button"
                  className="pipe-node-link"
                  onClick={() => {
                    const vIdx = pipes.v[selPipe];
                    setSelectedPipeIdx(null);
                    setSelectedNodeIdx(vIdx);
                  }}
                >
                  {nodes.columns.id[pipes.v[selPipe]]} →
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* SELECTED NODE CROSS-METRIC INSPECTOR CARD */}
        {sel !== null && (
          <aside className="inspector-card" aria-label="Selected Node Details">
            <div className="inspector-header">
              <div>
                <span className="inspector-badge">
                  {nodes.columns.type[sel] === 2
                    ? 'WTP RESERVOIR'
                    : nodes.columns.type[sel] === 1
                    ? 'ELEVATED TANK'
                    : 'JUNCTION NODE'}
                </span>
                <h3 className="inspector-title">{nodes.columns.id[sel]}</h3>
              </div>
              <button
                type="button"
                className="inspector-close"
                onClick={() => setSelectedNodeIdx(null)}
                aria-label="Close node details"
              >
                ✕
              </button>
            </div>

            <div className="inspector-tri-gauges">
              <div className={`gauge-box ${activeLayer === 'pressure' ? 'highlight' : ''}`}>
                <span className="gauge-name">STATIC PRESSURE</span>
                <span className="gauge-value">
                  {nodes.columns.p68[sel].toFixed(2)} <small>psi</small>
                </span>
                <span className="gauge-sub">
                  336h Mean: {nodes.columns.pAvg[sel].toFixed(2)} psi
                </span>
              </div>

              <div className={`gauge-box ${activeLayer === 'fireflow' ? 'highlight' : ''}`}>
                <span className="gauge-name">AVAIL. FIRE FLOW</span>
                <span className="gauge-value">
                  {nodes.columns.type[sel] === 0
                    ? nodes.columns.ff[sel].toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })
                    : 'N/A'}{' '}
                  <small>{nodes.columns.type[sel] === 0 ? 'gpm' : ''}</small>
                </span>
                <span className="gauge-sub">
                  Residual: {nodes.columns.resP[sel].toFixed(1)} psi (Hr 68)
                </span>
              </div>

              <div className={`gauge-box ${activeLayer === 'waterage' ? 'highlight' : ''}`}>
                <span className="gauge-name">WATER AGE (24H AVG)</span>
                <span className="gauge-value">
                  {nodes.columns.age24[sel].toFixed(2)} <small>hrs</small>
                </span>
                <span className="gauge-sub">
                  Net Travel: {nodes.columns.netAge[sel].toFixed(2)} hrs
                </span>
              </div>
            </div>

            {pipes && connectedPipesForSelectedNode.length > 0 && (
              <div className="connected-pipes-box">
                <div className="connected-pipes-title">
                  Connected Pipes ({connectedPipesForSelectedNode.length})
                </div>
                <div className="connected-pipes-list">
                  {connectedPipesForSelectedNode.map((pIdx) => (
                    <button
                      key={pipes.id[pIdx]}
                      type="button"
                      className="connected-pipe-chip"
                      onClick={() => {
                        setSelectedNodeIdx(null);
                        setSelectedPipeIdx(pIdx);
                      }}
                    >
                      <span className="cp-id">Pipe {pipes.id[pIdx]}</span>
                      <span className="cp-meta">
                        {pipes.diam[pIdx]}" • {formatPipeMaterial(pipes.mat[pIdx])}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="inspector-table">
              <div className="insp-row">
                <span>Elevation</span>
                <strong>{nodes.columns.elev[sel].toFixed(2)} ft</strong>
              </div>
              <div className="insp-row">
                <span>Hydraulic Grade (Hr 68)</span>
                <strong>{nodes.columns.head68[sel].toFixed(2)} ft</strong>
              </div>
              <div className="insp-row">
                <span>Peak Demand (Hr 68)</span>
                <strong>{nodes.columns.dem68[sel].toFixed(2)} gpm</strong>
              </div>
              <div className="insp-row">
                <span>Water Age (Hr 68 / Hr 336)</span>
                <strong>
                  {nodes.columns.age68[sel].toFixed(1)}h / {nodes.columns.age336[sel].toFixed(1)}h
                </strong>
              </div>
              <div className="insp-row">
                <span>Max Water Age (0–336h)</span>
                <strong>{nodes.columns.ageMax[sel].toFixed(1)} hrs</strong>
              </div>
              <div className="insp-row">
                <span>State Plane (EPSG:2264)</span>
                <strong>
                  {nodes.columns.x[sel].toFixed(1)}, {nodes.columns.y[sel].toFixed(1)} ft
                </strong>
              </div>
              <div className="insp-row">
                <span>WGS84 (Lat, Lng)</span>
                <strong>
                  {nodes.columns.lat[sel].toFixed(5)}, {nodes.columns.lng[sel].toFixed(5)}
                </strong>
              </div>
            </div>
          </aside>
        )}

        {/* BOTTOM 3D ORBIT, ROTATE & TILT CONTROL DOCK */}
        <div className="camera-dock">
          <div className="camera-buttons">
            <button
              type="button"
              className="cam-btn"
              onMouseDown={() => startSpin(-1)}
              onMouseUp={stopSpin}
              onMouseLeave={stopSpin}
              onTouchStart={() => startSpin(-1)}
              onTouchEnd={stopSpin}
              title="Hold to rotate counter-clockwise"
            >
              ⟲
            </button>
            <button
              type="button"
              className="cam-btn"
              onClick={() => applyCamera({ heading: 0, tilt: 0 })}
              title="Reset North (heading 0°, tilt 0°)"
            >
              ⬆ N
            </button>
            <button
              type="button"
              className={`cam-btn ${camera.tilt > 5 ? 'active' : ''}`}
              onClick={() => applyCamera({ tilt: camera.tilt > 5 ? 0 : 45 })}
              title="Toggle 2D / 45° 3D tilt"
            >
              3D
            </button>
            <button
              type="button"
              className="cam-btn"
              onMouseDown={() => startSpin(1)}
              onMouseUp={stopSpin}
              onMouseLeave={stopSpin}
              onTouchStart={() => startSpin(1)}
              onTouchEnd={stopSpin}
              title="Hold to rotate clockwise"
            >
              ⟳
            </button>
            <button
              type="button"
              className="cam-btn"
              onClick={() =>
                applyCamera({
                  zoom: Math.max(camera.zoom, 16.5),
                  tilt: 67.5,
                })
              }
              title="Street-level 67.5° 3D tilt"
            >
              🏙
            </button>
            <button
              type="button"
              className="cam-btn"
              onClick={() => applyCamera({ ...ARRAN_LAKE_DAM_VIEW })}
              title="Zoom to Arran Lake West Dam on Lakeridge Drive"
            >
              📍 Dam
            </button>
            <button
              type="button"
              className="cam-btn"
              onClick={resetFullNetwork}
              title="Zoom to full Fayetteville network bounds (flat, North)"
            >
              ⛶ Fit
            </button>
          </div>

          <div className="camera-sliders">
            <label className="cam-slider-group">
              <span>Rotate {Math.round(camera.heading)}°</span>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={Math.round(camera.heading)}
                onChange={(e) => applyCamera({ heading: Number(e.target.value) })}
              />
            </label>
            <label className="cam-slider-group">
              <span>Tilt {camera.tilt.toFixed(0)}°</span>
              <input
                type="range"
                min={0}
                max={67.5}
                step={0.5}
                value={camera.tilt}
                onChange={(e) => applyCamera({ tilt: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="camera-orbit-tip">
            Right-drag or Ctrl+drag to freely orbit 3D
          </div>
        </div>

        {/* LOWER-RIGHT GOOGLE STREET VIEW PEGMAN DOCK */}
        <div className="pegman-dock">
          <button
            type="button"
            className={`pegman-btn ${streetView.active ? 'active' : ''} ${
              pegmanDrag.dragging ? 'dragging' : ''
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              setPegmanDrag({
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                clientX: e.clientX,
                clientY: e.clientY,
                moved: false,
              });
            }}
            onTouchStart={(e) => {
              if (e.touches.length > 0) {
                const t = e.touches[0];
                setPegmanDrag({
                  dragging: true,
                  startX: t.clientX,
                  startY: t.clientY,
                  clientX: t.clientX,
                  clientY: t.clientY,
                  moved: false,
                });
              }
            }}
            title="Drag Pegman onto any street (or click) to open split-screen Street View"
            aria-label="Drag Google Street View Pegman onto map"
          >
            <svg
              width="30"
              height="38"
              viewBox="0 0 32 42"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="pegman-svg"
            >
              {/* Ground ring */}
              <ellipse cx="16" cy="38" rx="9" ry="2.6" fill="#BAE6FD" stroke="#0284C7" strokeWidth="1.4" />
              {/* Explorer / Engineer Hat */}
              <rect x="9.5" y="2" width="13" height="6" rx="2.5" fill="#0284C7" stroke="#0C4A6E" strokeWidth="1.2" />
              <rect x="9.5" y="6" width="13" height="1.8" fill="#FDE047" />
              <ellipse cx="16" cy="8.2" rx="10" ry="2.2" fill="#0284C7" stroke="#0C4A6E" strokeWidth="1.2" />
              {/* Pegman Head */}
              <circle cx="16" cy="13.5" r="4.8" fill="#FBBF24" stroke="#78350F" strokeWidth="1.3" />
              {/* Pegman Torso & Legs */}
              <rect x="10.8" y="19" width="10.4" height="11.5" rx="3.2" fill="#F59E0B" stroke="#78350F" strokeWidth="1.3" />
              <rect x="7.5" y="19.8" width="3" height="8.5" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="1.2" />
              <rect x="21.5" y="19.8" width="3" height="8.5" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="1.2" />
              <rect x="11.6" y="29.5" width="3.8" height="7.5" rx="1.6" fill="#D97706" stroke="#78350F" strokeWidth="1.2" />
              <rect x="16.6" y="29.5" width="3.8" height="7.5" rx="1.6" fill="#D97706" stroke="#78350F" strokeWidth="1.2" />
            </svg>
            <span className="pegman-label">Street View</span>
          </button>
        </div>

        {/* FLOATING PEGMAN DRAG GHOST */}
        {pegmanDrag.dragging && (
          <div
            className="pegman-drag-ghost"
            style={{
              left: `${pegmanDrag.clientX}px`,
              top: `${pegmanDrag.clientY}px`,
            }}
          >
            <div className="pegman-drop-ring" />
            <svg
              width="38"
              height="48"
              viewBox="0 0 32 42"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="9.5" y="2" width="13" height="6" rx="2.5" fill="#0284C7" stroke="#0C4A6E" strokeWidth="1.2" />
              <rect x="9.5" y="6" width="13" height="1.8" fill="#FDE047" />
              <ellipse cx="16" cy="8.2" rx="10" ry="2.2" fill="#0284C7" stroke="#0C4A6E" strokeWidth="1.2" />
              <circle cx="16" cy="13.5" r="4.8" fill="#FBBF24" stroke="#78350F" strokeWidth="1.3" />
              <rect x="10.8" y="19" width="10.4" height="11.5" rx="3.2" fill="#F59E0B" stroke="#78350F" strokeWidth="1.3" />
              <rect x="7.5" y="19.8" width="3" height="8.5" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="1.2" />
              <rect x="21.5" y="19.8" width="3" height="8.5" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="1.2" />
              <rect x="11.6" y="29.5" width="3.8" height="7.5" rx="1.6" fill="#D97706" stroke="#78350F" strokeWidth="1.2" />
              <rect x="16.6" y="29.5" width="3.8" height="7.5" rx="1.6" fill="#D97706" stroke="#78350F" strokeWidth="1.2" />
            </svg>
          </div>
        )}
        </main>

        {/* RIGHT HALF: GOOGLE STREET VIEW SPLIT PANE */}
        {streetView.active && (
          <StreetViewPanel
            streetView={streetView}
            onUpdateStreetView={handleUpdateStreetView}
            onPanMapTo={(lat, lng) => applyCamera({ lat, lng })}
            onClose={() =>
              setStreetView((prev) => ({
                ...prev,
                active: false,
              }))
            }
            nodes={nodes}
            pipes={pipes}
          />
        )}
      </div>

      {/* GOOGLE MAPS API KEY MODAL */}
      {showKeyModal && (
        <div className="modal-backdrop" onClick={() => setShowKeyModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3>@vis.gl/react-google-maps Configuration</h3>
            <p>
              Provide a Google Maps JavaScript API key (or set{' '}
              <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>.env.local</code>) to enable
              live Google Maps 3D vector tiles. When no key is set, the app uses its
              built-in 3D hydrographic slippy-tile engine so you can explore all 43,754
              nodes immediately.
            </p>
            <input
              type="text"
              className="modal-input"
              placeholder="AIzaSy..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={preferGoogleMaps}
                onChange={(e) => setPreferGoogleMaps(e.target.checked)}
              />
              <span>Use @vis.gl/react-google-maps when API key is provided</span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn secondary"
                onClick={() => {
                  localStorage.removeItem('FAY_GOOGLE_MAPS_API_KEY');
                  setStoredApiKey('');
                  setApiKeyInput('');
                  setGmAuthFailed(false);
                  setShowKeyModal(false);
                }}
              >
                Use Built-in 3D Basemap
              </button>
              <button
                type="button"
                className="modal-btn primary"
                onClick={() => {
                  const trimmed = apiKeyInput.trim();
                  if (trimmed) {
                    localStorage.setItem('FAY_GOOGLE_MAPS_API_KEY', trimmed);
                  }
                  setStoredApiKey(trimmed);
                  setGmAuthFailed(false);
                  setPreferGoogleMaps(true);
                  setShowKeyModal(false);
                }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default App;
