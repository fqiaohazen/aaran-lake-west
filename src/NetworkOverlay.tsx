import React, { useEffect, useRef, useCallback } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import {
  NetworkNodesPayload,
  NetworkPipesPayload,
  LayerConfig,
  hexToRgb,
} from './types';
import { StreetViewState } from './StreetViewPanel';

export interface CameraState {
  lat: number;
  lng: number;
  zoom: number;
  tilt: number;
  heading: number;
}

interface NetworkOverlayProps {
  nodes: NetworkNodesPayload;
  pipes: NetworkPipesPayload | null;
  nodeValues: Float32Array;
  nodeBins: Uint8Array;
  config: LayerConfig;
  hiddenBins: Set<number>;
  showPipes: boolean;
  showFacilities: boolean;
  pointSize: number;
  selectedNodeIdx: number | null;
  hoveredNodeIdx: number | null;
  selectedPipeIdx: number | null;
  hoveredPipeIdx: number | null;
  onHoverNode: (idx: number | null, screenPos: { x: number; y: number } | null) => void;
  onSelectNode: (idx: number | null) => void;
  onHoverPipe: (idx: number | null, screenPos: { x: number; y: number } | null) => void;
  onSelectPipe: (idx: number | null) => void;
  camera: CameraState;
  onCameraChange: (cam: CameraState) => void;
  useGoogleMaps: boolean;
  basemapStyle: 'dark' | 'satellite' | 'light';
  streetView: StreetViewState;
  onUpdateStreetView: (next: Partial<StreetViewState>) => void;
  screenToLatLngRef?: React.MutableRefObject<
    ((clientX: number, clientY: number) => { lat: number; lng: number } | null) | null
  >;
}

function latToMercY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

// Compute 3x3 homography mapping unit square (0,0),(1,0),(1,1),(0,1) -> 4 screen points
function computeQuadHomography(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
): Float64Array {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy = y0 - y1 + y2 - y3;

  const det = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(det) > 1e-10) {
    g = (sx * dy2 - sy * dx2) / det;
    h = (dx1 * sy - dy1 * sx) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  return new Float64Array([a, b, c, d, e, f, g, h, 1]);
}

// Project (lng, lat) to 3D tilted/rotated screen pixel in fallback/standalone camera
export function projectStandaloneLatLng(
  lat: number,
  lng: number,
  cam: CameraState,
  width: number,
  height: number
): [number, number] {
  const scale = 256 * Math.pow(2, cam.zoom);
  const worldX = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const worldY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;

  const centerWorldX = ((cam.lng + 180) / 360) * scale;
  const sinCenterLat = Math.sin((cam.lat * Math.PI) / 180);
  const centerWorldY =
    (0.5 - Math.log((1 + sinCenterLat) / (1 - sinCenterLat)) / (4 * Math.PI)) *
    scale;

  const dx = worldX - centerWorldX;
  const dy = worldY - centerWorldY;

  // Rotate by -heading
  const radH = (-cam.heading * Math.PI) / 180;
  const cosH = Math.cos(radH);
  const sinH = Math.sin(radH);
  const rx = dx * cosH - dy * sinH;
  const ry = dx * sinH + dy * cosH;

  // Tilt (foreshorten Y with slight perspective)
  const radT = (cam.tilt * Math.PI) / 180;
  const cosT = Math.cos(radT);
  const sinT = Math.sin(radT);
  const fovDist = Math.max(800, height * 1.15);
  const z = ry * sinT;
  const persp = fovDist / Math.max(120, fovDist - z);

  const sx = width * 0.5 + rx * persp;
  const sy = height * 0.5 + ry * cosT * persp;
  return [sx, sy];
}

// Inverse project screen pixel (sx, sy) to (lat, lng) in standalone camera
export function unprojectStandaloneScreen(
  sx: number,
  sy: number,
  cam: CameraState,
  width: number,
  height: number
): { lat: number; lng: number } {
  const radT = (cam.tilt * Math.PI) / 180;
  const cosT = Math.max(0.25, Math.cos(radT));
  const sinT = Math.sin(radT);
  const fovDist = Math.max(800, height * 1.15);

  const u = sx - width * 0.5;
  const v = sy - height * 0.5;
  // Since v = ry * cosT * fovDist / (fovDist - ry * sinT)
  const denom = cosT * fovDist + v * sinT;
  const ry = Math.abs(denom) > 1e-5 ? (v * fovDist) / denom : v / cosT;
  const persp = fovDist / Math.max(120, fovDist - ry * sinT);
  const rx = u / persp;

  const radH = (cam.heading * Math.PI) / 180;
  const cosH = Math.cos(radH);
  const sinH = Math.sin(radH);
  const dx = rx * cosH - ry * sinH;
  const dy = rx * sinH + ry * cosH;

  const scale = 256 * Math.pow(2, cam.zoom);
  const centerWorldX = ((cam.lng + 180) / 360) * scale;
  const sinCenterLat = Math.sin((cam.lat * Math.PI) / 180);
  const centerWorldY =
    (0.5 - Math.log((1 + sinCenterLat) / (1 - sinCenterLat)) / (4 * Math.PI)) *
    scale;

  const worldX = centerWorldX + dx;
  const worldY = centerWorldY + dy;

  const lng = (worldX / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * worldY) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export const NetworkOverlay: React.FC<NetworkOverlayProps> = ({
  nodes,
  pipes,
  nodeValues,
  nodeBins,
  config,
  hiddenBins,
  showPipes,
  showFacilities,
  pointSize,
  selectedNodeIdx,
  hoveredNodeIdx,
  selectedPipeIdx,
  hoveredPipeIdx,
  onHoverNode,
  onSelectNode,
  onHoverPipe,
  onSelectPipe,
  camera,
  onCameraChange,
  useGoogleMaps,
  basemapStyle,
  streetView,
  onUpdateStreetView,
  screenToLatLngRef,
}) => {
  const gmap = useMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  const svScreenPosRef = useRef<{ x: number; y: number } | null>(null);

  // Precomputed normalized coordinates s, t in [0, 1] for fast homography projection
  const normCoordsRef = useRef<{ s: Float32Array; t: Float32Array } | null>(null);
  // Screen coordinates cache for instant hover/click picking
  const screenXRef = useRef<Float32Array>(new Float32Array(0));
  const screenYRef = useRef<Float32Array>(new Float32Array(0));
  // Tile image cache for standalone basemap
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const count = nodes.count;
    const s = new Float32Array(count);
    const t = new Float32Array(count);
    const { west, east, south, north } = nodes.bounds;
    const spanLng = Math.max(1e-6, east - west);
    const mercSouth = latToMercY(south);
    const mercNorth = latToMercY(north);
    const spanMercY = mercNorth - mercSouth;
    const lngs = nodes.columns.lng;
    const lats = nodes.columns.lat;

    for (let i = 0; i < count; i++) {
      s[i] = (lngs[i] - west) / spanLng;
      t[i] = (latToMercY(lats[i]) - mercSouth) / spanMercY;
    }
    normCoordsRef.current = { s, t };
    screenXRef.current = new Float32Array(count);
    screenYRef.current = new Float32Array(count);
  }, [nodes]);

  // Attach Google Maps OverlayView when gmap is available
  useEffect(() => {
    if (!gmap || !window.google?.maps) return;
    class CustomProjectionOverlay extends window.google.maps.OverlayView {
      onAdd() {}
      draw() {}
      onRemove() {}
    }
    const ov = new CustomProjectionOverlay();
    ov.setMap(gmap);
    overlayRef.current = ov;
    return () => {
      ov.setMap(null);
      overlayRef.current = null;
    };
  }, [gmap]);

  // Draw slippy map tiles in standalone mode
  const drawStandaloneBasemap = useCallback(
    (width: number, height: number, dpr: number) => {
      const tileCanvas = tileCanvasRef.current;
      if (!tileCanvas) return;
      if (tileCanvas.width !== Math.round(width * dpr) || tileCanvas.height !== Math.round(height * dpr)) {
        tileCanvas.width = Math.round(width * dpr);
        tileCanvas.height = Math.round(height * dpr);
      }
      const ctx = tileCanvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = basemapStyle === 'light' ? '#E5E9F0' : '#080F1A';
      ctx.fillRect(0, 0, width, height);

      const z = Math.max(9, Math.min(18, Math.floor(camera.zoom)));
      const numTiles = 1 << z;
      const scaleAtZ = 256 * numTiles;

      const centerWorldX = ((camera.lng + 180) / 360) * scaleAtZ;
      const sinLat = Math.sin((camera.lat * Math.PI) / 180);
      const centerWorldY =
        (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scaleAtZ;

      const centerTileX = Math.floor(centerWorldX / 256);
      const centerTileY = Math.floor(centerWorldY / 256);

      const zoomFactor = Math.pow(2, camera.zoom - z);
      const radH = (-camera.heading * Math.PI) / 180;
      const radT = (camera.tilt * Math.PI) / 180;
      const cosT = Math.cos(radT);

      ctx.translate(width * 0.5, height * 0.5);
      ctx.scale(1, cosT);
      ctx.rotate(radH);
      ctx.scale(zoomFactor, zoomFactor);

      const radiusX = Math.ceil(width / (256 * zoomFactor)) + 2;
      const radiusY = Math.ceil(height / (256 * zoomFactor * Math.max(0.35, cosT))) + 2;

      for (let dy = -radiusY; dy <= radiusY; dy++) {
        for (let dx = -radiusX; dx <= radiusX; dx++) {
          const tx = centerTileX + dx;
          const ty = centerTileY + dy;
          if (tx < 0 || ty < 0 || tx >= numTiles || ty >= numTiles) continue;

          const key = `${basemapStyle}_${z}_${tx}_${ty}`;
          let img = tileCacheRef.current.get(key);
          if (!img) {
            img = new Image();
            img.crossOrigin = 'anonymous';
            if (basemapStyle === 'satellite') {
              img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
            } else if (basemapStyle === 'light') {
              img.src = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${tx}/${ty}.png`;
            } else {
              img.src = `https://a.basemaps.cartocdn.com/dark_all/${z}/${tx}/${ty}.png`;
            }
            img.onload = () => {
              if (rafRef.current === null) {
                rafRef.current = requestAnimationFrame(() => {
                  rafRef.current = null;
                  renderFrame();
                });
              }
            };
            tileCacheRef.current.set(key, img);
          }

          const drawX = tx * 256 - centerWorldX;
          const drawY = ty * 256 - centerWorldY;
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, drawX, drawY, 256.5, 256.5);
          } else {
            ctx.strokeStyle =
              basemapStyle === 'light'
                ? 'rgba(15, 29, 51, 0.08)'
                : 'rgba(140, 162, 192, 0.08)';
            ctx.strokeRect(drawX, drawY, 256, 256);
          }
        }
      }

      ctx.restore();
    },
    [camera, basemapStyle]
  );

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const norm = normCoordsRef.current;
    if (!canvas || !norm) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    if (!useGoogleMaps) {
      drawStandaloneBasemap(width, height, dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { west, east, south, north } = nodes.bounds;

    // Compute 4 corner screen locations
    let p0: [number, number];
    let p1: [number, number];
    let p2: [number, number];
    let p3: [number, number];

    const proj = useGoogleMaps ? overlayRef.current?.getProjection() : null;
    if (useGoogleMaps && proj && window.google?.maps) {
      const c0 = proj.fromLatLngToContainerPixel(new window.google.maps.LatLng(south, west));
      const c1 = proj.fromLatLngToContainerPixel(new window.google.maps.LatLng(south, east));
      const c2 = proj.fromLatLngToContainerPixel(new window.google.maps.LatLng(north, east));
      const c3 = proj.fromLatLngToContainerPixel(new window.google.maps.LatLng(north, west));
      if (!c0 || !c1 || !c2 || !c3) {
        ctx.restore();
        return;
      }
      p0 = [c0.x, c0.y];
      p1 = [c1.x, c1.y];
      p2 = [c2.x, c2.y];
      p3 = [c3.x, c3.y];
    } else {
      p0 = projectStandaloneLatLng(south, west, camera, width, height);
      p1 = projectStandaloneLatLng(south, east, camera, width, height);
      p2 = projectStandaloneLatLng(north, east, camera, width, height);
      p3 = projectStandaloneLatLng(north, west, camera, width, height);
    }

    const H = computeQuadHomography(
      p0[0], p0[1],
      p1[0], p1[1],
      p2[0], p2[1],
      p3[0], p3[1]
    );
    const h0 = H[0], h1 = H[1], h2 = H[2];
    const h3 = H[3], h4 = H[4], h5 = H[5];
    const h6 = H[6], h7 = H[7];

    const count = nodes.count;
    const sArr = norm.s;
    const tArr = norm.t;
    const sxArr = screenXRef.current;
    const syArr = screenYRef.current;

    for (let i = 0; i < count; i++) {
      const s = sArr[i];
      const t = tArr[i];
      const w = 1.0 / (h6 * s + h7 * t + 1.0);
      sxArr[i] = (h0 * s + h1 * t + h2) * w;
      syArr[i] = (h3 * s + h4 * t + h5) * w;
    }

    // 1. Optional Pipe Network Layer (46,055 pipes)
    if (showPipes && pipes) {
      const uArr = pipes.u;
      const vArr = pipes.v;
      const dArr = pipes.diam;
      const pCount = pipes.count;

      // Trunk mains (>= 12 in) vs distribution mains (< 12 in)
      ctx.beginPath();
      ctx.strokeStyle =
        basemapStyle === 'light'
          ? 'rgba(30, 58, 95, 0.28)'
          : 'rgba(120, 165, 220, 0.22)';
      ctx.lineWidth = Math.max(0.6, (camera.zoom - 10) * 0.28);
      for (let i = 0; i < pCount; i++) {
        if (dArr[i] >= 12) continue;
        const u = uArr[i];
        const v = vArr[i];
        const x1 = sxArr[u];
        const y1 = syArr[u];
        if (x1 < -20 || x1 > width + 20 || y1 < -20 || y1 > height + 20) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(sxArr[v], syArr[v]);
      }
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle =
        basemapStyle === 'light'
          ? 'rgba(15, 40, 80, 0.55)'
          : 'rgba(148, 205, 255, 0.48)';
      ctx.lineWidth = Math.max(1.3, (camera.zoom - 9) * 0.45);
      for (let i = 0; i < pCount; i++) {
        if (dArr[i] < 12) continue;
        const u = uArr[i];
        const v = vArr[i];
        const x1 = sxArr[u];
        const y1 = syArr[u];
        if (x1 < -40 || x1 > width + 40 || y1 < -40 || y1 > height + 40) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(sxArr[v], syArr[v]);
      }
      ctx.stroke();
    }

    // 2. Render all 43,747 Junctions via fast ImageData / batched path
    const zoomScale = Math.max(0.75, Math.min(2.6, Math.pow(1.22, camera.zoom - 11.5)));
    const radius = Math.max(0.72, pointSize * zoomScale);
    const types = nodes.columns.type;

    if (radius <= 2.0) {
      // Ultra-fast batched fillRect per color bin
      for (let b = 0; b < config.bins.length; b++) {
        if (hiddenBins.has(b)) continue;
        ctx.fillStyle = config.bins[b].color;
        const size = radius * 1.9;
        const half = size * 0.5;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          if (types[i] !== 0 || nodeBins[i] !== b) continue;
          const x = sxArr[i];
          const y = syArr[i];
          if (x < -4 || x > width + 4 || y < -4 || y > height + 4) continue;
          ctx.rect(x - half, y - half, size, size);
        }
        ctx.fill();
      }
    } else {
      // Higher zoom: crisp circular markers with subtle outline
      for (let b = 0; b < config.bins.length; b++) {
        if (hiddenBins.has(b)) continue;
        const [r, g, bl] = hexToRgb(config.bins[b].color);
        ctx.fillStyle = `rgb(${r},${g},${bl})`;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          if (types[i] !== 0 || nodeBins[i] !== b) continue;
          const x = sxArr[i];
          const y = syArr[i];
          if (x < -10 || x > width + 10 || y < -10 || y > height + 10) continue;
          ctx.moveTo(x + radius, y);
          ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }

    // 3. Render 5 Elevated Storage Tanks & 2 WTP Reservoirs prominently on top
    if (showFacilities) {
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < count; i++) {
        const tCode = types[i];
        if (tCode === 0) continue;
        const x = sxArr[i];
        const y = syArr[i];
        if (x < -50 || x > width + 50 || y < -50 || y > height + 50) continue;

        const isRes = tCode === 2;
        const bg = isRes ? '#00D2FF' : '#F59E0B';
        const fg = '#07101E';
        const r = isRes ? 9 : 7.5;

        // Outer halo
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = isRes ? 'rgba(0, 210, 255, 0.28)' : 'rgba(245, 158, 11, 0.28)';
        ctx.fill();

        // Facility badge
        ctx.beginPath();
        if (isRes) {
          ctx.rect(x - r, y - r, r * 2, r * 2);
        } else {
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#07101E';
        ctx.stroke();

        // Label callout
        let label = nodes.columns.id[i];
        if (config.id === 'waterage') {
          label = `${nodes.columns.id[i]} (${nodeValues[i].toFixed(1)}h)`;
        } else if (config.id === 'pressure') {
          label = `${nodes.columns.id[i]} (${nodes.columns.head68[i].toFixed(0)} ft)`;
        }
        const textW = ctx.measureText(label).width;
        const lx = x + r + 6;
        const ly = y;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.strokeStyle = isRes ? '#0284C7' : '#D97706';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.roundRect(lx - 4, ly - 10, textW + 8, 20, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#0F172A';
        ctx.fillText(label, lx, ly);

        // Mini letter inside icon
        ctx.fillStyle = fg;
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(isRes ? 'W' : 'T', x, y + 0.5);
        ctx.textAlign = 'left';
        ctx.font = '600 11px "JetBrains Mono", monospace';
      }
    }

    // 4. Highlight hovered and selected pipes
    const drawHighlightPipe = (pIdx: number, color: string, widthPx: number) => {
      if (!pipes || pIdx < 0 || pIdx >= pipes.count) return;
      const u = pipes.u[pIdx];
      const v = pipes.v[pIdx];
      const x1 = sxArr[u];
      const y1 = syArr[u];
      const x2 = sxArr[v];
      const y2 = syArr[v];

      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = widthPx + 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.stroke();
      ctx.restore();
    };

    if (hoveredPipeIdx !== null && hoveredPipeIdx >= 0) {
      drawHighlightPipe(hoveredPipeIdx, '#0284C7', 4.5);
    }
    if (selectedPipeIdx !== null && selectedPipeIdx >= 0) {
      drawHighlightPipe(selectedPipeIdx, '#EA580C', 5.5);
    }

    // 5. Highlight hovered and selected nodes
    const drawHighlightRing = (idx: number, color: string, ringR: number) => {
      const x = sxArr[idx];
      const y = syArr[idx];
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    };

    if (hoveredNodeIdx !== null && hoveredNodeIdx >= 0) {
      drawHighlightRing(hoveredNodeIdx, '#0284C7', 10);
    }
    if (selectedNodeIdx !== null && selectedNodeIdx >= 0) {
      drawHighlightRing(selectedNodeIdx, '#0284C7', 13);
    }

    // 6. Draw Street View Cone ("coner") + Pegman with Hat on the left map pane
    if (streetView.active) {
      let svX = 0;
      let svY = 0;
      if (useGoogleMaps && proj && window.google?.maps) {
        const pt = proj.fromLatLngToContainerPixel(
          new window.google.maps.LatLng(streetView.lat, streetView.lng)
        );
        if (pt) {
          svX = pt.x;
          svY = pt.y;
        }
      } else {
        const [px, py] = projectStandaloneLatLng(
          streetView.lat,
          streetView.lng,
          camera,
          width,
          height
        );
        svX = px;
        svY = py;
      }
      svScreenPosRef.current = { x: svX, y: svY };

      // Field-of-view directional cone ("coner") showing Street View heading
      const relHeadingDeg = streetView.heading - camera.heading;
      const centerAngle = ((relHeadingDeg - 90) * Math.PI) / 180;
      const halfSpread = (34 * Math.PI) / 180;
      const coneRadius = 58;

      ctx.save();
      const grad = ctx.createRadialGradient(svX, svY, 4, svX, svY, coneRadius);
      grad.addColorStop(0, 'rgba(2, 132, 199, 0.62)');
      grad.addColorStop(0.65, 'rgba(14, 165, 233, 0.30)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.04)');

      ctx.beginPath();
      ctx.moveTo(svX, svY);
      ctx.arc(svX, svY, coneRadius, centerAngle - halfSpread, centerAngle + halfSpread);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Cone edge rays + outer arc
      ctx.beginPath();
      ctx.moveTo(
        svX + Math.cos(centerAngle - halfSpread) * coneRadius,
        svY + Math.sin(centerAngle - halfSpread) * coneRadius
      );
      ctx.lineTo(svX, svY);
      ctx.lineTo(
        svX + Math.cos(centerAngle + halfSpread) * coneRadius,
        svY + Math.sin(centerAngle + halfSpread) * coneRadius
      );
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(svX, svY, coneRadius * 0.78, centerAngle - halfSpread, centerAngle + halfSpread);
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ground anchor shadow & white halo disc at (svX, svY)
      ctx.beginPath();
      ctx.arc(svX, svY, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0284C7';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(svX, svY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0284C7';
      ctx.fill();

      // Draw Pegman + Hat standing on the anchor point
      // Legs & torso
      ctx.fillStyle = '#F59E0B';
      ctx.strokeStyle = '#78350F';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(svX - 5.5, svY - 19, 11, 13, 3.5);
      ctx.fill();
      ctx.stroke();

      // Arms
      ctx.beginPath();
      ctx.roundRect(svX - 8.5, svY - 18, 3.2, 9, 1.5);
      ctx.roundRect(svX + 5.3, svY - 18, 3.2, 9, 1.5);
      ctx.fill();
      ctx.stroke();

      // Pegman Head
      ctx.beginPath();
      ctx.arc(svX, svY - 25, 5.8, 0, Math.PI * 2);
      ctx.fillStyle = '#FBBF24';
      ctx.fill();
      ctx.stroke();

      // Explorer / Engineer Hat on top of Pegman's head
      // Hat brim
      ctx.beginPath();
      ctx.ellipse(svX, svY - 29.5, 9.5, 2.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0284C7';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#0C4A6E';
      ctx.stroke();

      // Hat crown
      ctx.beginPath();
      ctx.roundRect(svX - 6, svY - 36, 12, 6.8, [4, 4, 1, 1]);
      ctx.fillStyle = '#0284C7';
      ctx.fill();
      ctx.stroke();

      // Golden hat ribbon band
      ctx.beginPath();
      ctx.rect(svX - 6, svY - 31.2, 12, 2);
      ctx.fillStyle = '#FDE047';
      ctx.fill();

      ctx.restore();
    } else {
      svScreenPosRef.current = null;
    }

    ctx.restore();
  }, [
    nodes,
    pipes,
    nodeValues,
    nodeBins,
    config,
    hiddenBins,
    showPipes,
    showFacilities,
    pointSize,
    selectedNodeIdx,
    hoveredNodeIdx,
    selectedPipeIdx,
    hoveredPipeIdx,
    camera,
    useGoogleMaps,
    basemapStyle,
    streetView,
    drawStandaloneBasemap,
  ]);

  // Redraw when props change
  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  // Attach Google Maps listeners to redraw in sync with pan/zoom/tilt/rotate
  useEffect(() => {
    if (!gmap || !useGoogleMaps || !window.google?.maps) return;
    const trigger = () => renderFrame();
    const listeners = [
      gmap.addListener('bounds_changed', trigger),
      gmap.addListener('center_changed', trigger),
      gmap.addListener('zoom_changed', trigger),
      gmap.addListener('tilt_changed', trigger),
      gmap.addListener('heading_changed', trigger),
      gmap.addListener('projection_changed', trigger),
      gmap.addListener('idle', trigger),
    ];
    return () => {
      listeners.forEach((l) => l.remove());
    };
  }, [gmap, useGoogleMaps, renderFrame]);

  // Resize observer (handles both window resize and split-screen 50% width transition)
  useEffect(() => {
    const onResize = () => renderFrame();
    window.addEventListener('resize', onResize);
    const parent = canvasRef.current?.parentElement;
    let ro: ResizeObserver | null = null;
    if (parent && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (gmap && window.google?.maps?.event) {
          window.google.maps.event.trigger(gmap, 'resize');
        }
        renderFrame();
      });
      ro.observe(parent);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [renderFrame, gmap]);

  // Convert client screen coordinates (clientX, clientY) to map { lat, lng }
  const clientPointToLatLng = useCallback(
    (clientX: number, clientY: number): { lat: number; lng: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }
      const mx = clientX - rect.left;
      const my = clientY - rect.top;

      const proj = useGoogleMaps ? overlayRef.current?.getProjection() : null;
      if (useGoogleMaps && proj && window.google?.maps) {
        const ll = proj.fromContainerPixelToLatLng(new window.google.maps.Point(mx, my));
        if (ll) {
          return { lat: ll.lat(), lng: ll.lng() };
        }
      }
      return unprojectStandaloneScreen(mx, my, camera, rect.width, rect.height);
    },
    [useGoogleMaps, camera]
  );

  useEffect(() => {
    if (screenToLatLngRef) {
      screenToLatLngRef.current = clientPointToLatLng;
    }
  }, [screenToLatLngRef, clientPointToLatLng]);

  // Find nearest visible node to screen point (mx, my)
  const findNearestNode = useCallback(
    (mx: number, my: number): number | null => {
      const sxArr = screenXRef.current;
      const syArr = screenYRef.current;
      const types = nodes.columns.type;
      const count = nodes.count;
      let bestIdx: number | null = null;
      let bestDistSq = 9 * 9; // 9px pick radius so pipes between nodes are easy to hover/click

      // Prioritize Tanks & Reservoirs first if facilities are shown
      if (showFacilities) {
        for (let i = 0; i < count; i++) {
          if (types[i] === 0) continue;
          const dx = sxArr[i] - mx;
          const dy = syArr[i] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 16 * 16 && d2 < bestDistSq) {
            bestDistSq = d2;
            bestIdx = i;
          }
        }
        if (bestIdx !== null) return bestIdx;
      }

      for (let i = 0; i < count; i++) {
        if (types[i] === 0 && hiddenBins.has(nodeBins[i])) continue;
        const dx = sxArr[i] - mx;
        if (dx > 9 || dx < -9) continue;
        const dy = syArr[i] - my;
        if (dy > 9 || dy < -9) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
      return bestIdx;
    },
    [nodes, nodeBins, hiddenBins, showFacilities]
  );

  // Find nearest visible pipe segment to screen point (mx, my)
  const findNearestPipe = useCallback(
    (mx: number, my: number): { idx: number; x: number; y: number } | null => {
      if (!showPipes || !pipes) return null;
      const sxArr = screenXRef.current;
      const syArr = screenYRef.current;
      const uArr = pipes.u;
      const vArr = pipes.v;
      const pCount = pipes.count;
      const tol = 8;
      let bestIdx: number | null = null;
      let bestDistSq = tol * tol;
      let bestX = mx;
      let bestY = my;

      for (let i = 0; i < pCount; i++) {
        const u = uArr[i];
        const v = vArr[i];
        const x1 = sxArr[u];
        const y1 = syArr[u];
        const x2 = sxArr[v];
        const y2 = syArr[v];

        const minX = x1 < x2 ? x1 : x2;
        const maxX = x1 > x2 ? x1 : x2;
        if (mx < minX - tol || mx > maxX + tol) continue;

        const minY = y1 < y2 ? y1 : y2;
        const maxY = y1 > y2 ? y1 : y2;
        if (my < minY - tol || my > maxY + tol) continue;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        let t = 0;
        if (lenSq > 1e-4) {
          t = ((mx - x1) * dx + (my - y1) * dy) / lenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
        }
        const px = x1 + t * dx;
        const py = y1 + t * dy;
        const ddx = mx - px;
        const ddy = my - py;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
          bestX = px;
          bestY = py;
        }
      }

      if (bestIdx === null) return null;
      return { idx: bestIdx, x: bestX, y: bestY };
    },
    [showPipes, pipes]
  );

  // Orbit / Pan / Pegman-drag interaction state
  const interactionRef = useRef<{
    mode: 'none' | 'orbit' | 'pan' | 'pegman';
    startX: number;
    startY: number;
    moved: boolean;
    startCam: CameraState;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    moved: false,
    startCam: camera,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Check if clicking directly on the active Pegman/hat marker on the left map
      if (e.button === 0 && streetView.active && svScreenPosRef.current) {
        const dxPeg = mx - svScreenPosRef.current.x;
        const dyPeg = my - (svScreenPosRef.current.y - 16);
        if (dxPeg * dxPeg + dyPeg * dyPeg <= 24 * 24) {
          e.preventDefault();
          e.stopPropagation();
          interactionRef.current = {
            mode: 'pegman',
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
            startCam: { ...camera },
          };
          return;
        }
      }

      const isOrbitGesture =
        e.button === 2 ||
        (e.button === 0 && (e.ctrlKey || e.altKey || e.shiftKey));

      if (isOrbitGesture) {
        e.preventDefault();
        e.stopPropagation();
        interactionRef.current = {
          mode: 'orbit',
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          startCam: { ...camera },
        };
      } else if (!useGoogleMaps && e.button === 0) {
        interactionRef.current = {
          mode: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          startCam: { ...camera },
        };
      } else {
        interactionRef.current = {
          mode: 'none',
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          startCam: { ...camera },
        };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const state = interactionRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (state.mode === 'pegman') {
        state.moved = true;
        const ll = clientPointToLatLng(e.clientX, e.clientY);
        if (ll) {
          onUpdateStreetView({
            lat: ll.lat,
            lng: ll.lng,
          });
        }
        return;
      }

      if (state.mode === 'orbit') {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.moved = true;

        const nextHeading = (((state.startCam.heading + dx * 0.45) % 360) + 360) % 360;
        const nextTilt = Math.max(0, Math.min(67.5, state.startCam.tilt - dy * 0.35));

        onCameraChange({
          ...camera,
          heading: nextHeading,
          tilt: nextTilt,
        });
        if (useGoogleMaps && gmap) {
          gmap.moveCamera({ heading: nextHeading, tilt: nextTilt });
        }
        return;
      }

      if (state.mode === 'pan' && !useGoogleMaps) {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.moved = true;

        const newCenter = unprojectStandaloneScreen(
          rect.width * 0.5 - dx,
          rect.height * 0.5 - dy,
          state.startCam,
          rect.width,
          rect.height
        );
        onCameraChange({
          ...state.startCam,
          lat: newCenter.lat,
          lng: newCenter.lng,
        });
        return;
      }

      // Hover node or pipe check when not dragging
      if (e.buttons === 0) {
        const hitNode = findNearestNode(mx, my);
        if (hitNode !== null) {
          onHoverPipe(null, null);
          onHoverNode(hitNode, { x: sxArrVal(hitNode), y: syArrVal(hitNode) });
        } else {
          onHoverNode(null, null);
          const hitPipe = findNearestPipe(mx, my);
          if (hitPipe !== null) {
            onHoverPipe(hitPipe.idx, { x: hitPipe.x, y: hitPipe.y });
          } else {
            onHoverPipe(null, null);
          }
        }
      }
    };

    const sxArrVal = (idx: number) => screenXRef.current[idx] || 0;
    const syArrVal = (idx: number) => screenYRef.current[idx] || 0;

    const onMouseUp = (e: MouseEvent) => {
      const state = interactionRef.current;
      const wasMoved = state.moved;
      state.mode = 'none';
      state.moved = false;

      if (!wasMoved && e.button === 0 && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hitNode = findNearestNode(mx, my);
        if (hitNode !== null) {
          onSelectPipe(null);
          onSelectNode(hitNode);
        } else {
          const hitPipe = findNearestPipe(mx, my);
          if (hitPipe !== null) {
            onSelectNode(null);
            onSelectPipe(hitPipe.idx);
          } else {
            onSelectNode(null);
            onSelectPipe(null);
          }
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (useGoogleMaps) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.0018;
      const nextZoom = Math.max(9.5, Math.min(19, camera.zoom + delta));
      onCameraChange({
        ...camera,
        zoom: nextZoom,
      });
    };

    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
    };
  }, [
    camera,
    onCameraChange,
    useGoogleMaps,
    gmap,
    streetView.active,
    clientPointToLatLng,
    onUpdateStreetView,
    findNearestNode,
    findNearestPipe,
    onHoverNode,
    onSelectNode,
    onHoverPipe,
    onSelectPipe,
  ]);

  return (
    <>
      {!useGoogleMaps && (
        <canvas
          ref={tileCanvasRef}
          className="basemap-tile-canvas"
          aria-hidden="true"
        />
      )}
      <canvas
        ref={canvasRef}
        className="network-overlay-canvas"
        style={{
          pointerEvents: useGoogleMaps ? 'none' : 'auto',
        }}
      />
    </>
  );
};
