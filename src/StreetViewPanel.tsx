import React, { useEffect, useRef, useState } from 'react';
import {
  NetworkNodesPayload,
  NetworkPipesPayload,
  formatPipeMaterial,
} from './types';

export interface StreetViewState {
  active: boolean;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  description: string;
  panoId: string;
}

interface StreetViewPanelProps {
  streetView: StreetViewState;
  onUpdateStreetView: (next: Partial<StreetViewState>) => void;
  onPanMapTo?: (lat: number, lng: number) => void;
  onClose: () => void;
  nodes: NetworkNodesPayload;
  pipes: NetworkPipesPayload | null;
}

export const StreetViewPanel: React.FC<StreetViewPanelProps> = ({
  streetView,
  onUpdateStreetView,
  onPanMapTo,
  onClose,
  nodes,
  pipes,
}) => {
  const panoContainerRef = useRef<HTMLDivElement>(null);
  const panoInstanceRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const updatingFromMapRef = useRef<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Initialize Google StreetViewPanorama once when panel mounts
  useEffect(() => {
    const el = panoContainerRef.current;
    if (!el || !window.google?.maps?.StreetViewPanorama) return;

    const pano = new window.google.maps.StreetViewPanorama(el, {
      position: { lat: streetView.lat, lng: streetView.lng },
      pov: { heading: streetView.heading, pitch: streetView.pitch },
      zoom: 1,
      visible: true,
      addressControl: true,
      linksControl: true,
      panControl: true,
      zoomControl: true,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
      showRoadLabels: true,
    });

    panoInstanceRef.current = pano;

    // Snap initial drop position to nearest Street View panorama within 250m
    const svService = new window.google.maps.StreetViewService();
    svService.getPanorama(
      {
        location: { lat: streetView.lat, lng: streetView.lng },
        radius: 250,
        preference: window.google.maps.StreetViewPreference.NEAREST,
      },
      (data, status) => {
        if (status === window.google.maps.StreetViewStatus.OK && data?.location?.latLng) {
          setStatusMsg(null);
          const snapLat = data.location.latLng.lat();
          const snapLng = data.location.latLng.lng();
          updatingFromMapRef.current = true;
          pano.setPosition(data.location.latLng);
          updatingFromMapRef.current = false;
          onUpdateStreetView({
            lat: snapLat,
            lng: snapLng,
            description: data.location.description || 'Fayetteville Street View',
            panoId: data.location.pano || '',
          });
          onPanMapTo?.(snapLat, snapLng);
        }
      }
    );

    const posListener = pano.addListener('position_changed', () => {
      if (updatingFromMapRef.current) return;
      const pos = pano.getPosition();
      if (!pos) return;
      const newLat = pos.lat();
      const newLng = pos.lng();
      const loc = pano.getLocation();
      onUpdateStreetView({
        lat: newLat,
        lng: newLng,
        description: loc?.description || streetView.description,
        panoId: pano.getPano() || '',
      });
      onPanMapTo?.(newLat, newLng);
    });

    const povListener = pano.addListener('pov_changed', () => {
      if (updatingFromMapRef.current) return;
      const pov = pano.getPov();
      if (!pov) return;
      const h = (((pov.heading % 360) + 360) % 360);
      const p = pov.pitch ?? 0;
      onUpdateStreetView({
        heading: h,
        pitch: p,
      });
    });

    const statusListener = pano.addListener('status_changed', () => {
      const st = pano.getStatus();
      if (st === window.google.maps.StreetViewStatus.OK) {
        setStatusMsg(null);
        const loc = pano.getLocation();
        const pos = pano.getPosition();
        if (pos) {
          onUpdateStreetView({
            lat: pos.lat(),
            lng: pos.lng(),
            description: loc?.description || 'Street View Panorama',
            panoId: pano.getPano() || '',
          });
        }
      } else {
        setStatusMsg('No Street View imagery at exact drop point — searching nearby road…');
      }
    });

    return () => {
      posListener.remove();
      povListener.remove();
      statusListener.remove();
      panoInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external position changes (e.g. when user drags Pegman again on the left map)
  useEffect(() => {
    const pano = panoInstanceRef.current;
    if (!pano || !window.google?.maps) return;

    const curPos = pano.getPosition();
    const dLat = curPos ? Math.abs(curPos.lat() - streetView.lat) : 1;
    const dLng = curPos ? Math.abs(curPos.lng() - streetView.lng) : 1;

    if (dLat > 1e-5 || dLng > 1e-5) {
      const svService = new window.google.maps.StreetViewService();
      svService.getPanorama(
        {
          location: { lat: streetView.lat, lng: streetView.lng },
          radius: 250,
          preference: window.google.maps.StreetViewPreference.NEAREST,
        },
        (data, status) => {
          if (status === window.google.maps.StreetViewStatus.OK && data?.location?.latLng) {
            setStatusMsg(null);
            updatingFromMapRef.current = true;
            pano.setPosition(data.location.latLng);
            updatingFromMapRef.current = false;
            onUpdateStreetView({
              lat: data.location.latLng.lat(),
              lng: data.location.latLng.lng(),
              description: data.location.description || 'Fayetteville Street View',
              panoId: data.location.pano || '',
            });
          } else {
            setStatusMsg('No Street View coverage within 250m of this point.');
          }
        }
      );
    }

    const curPov = pano.getPov();
    if (curPov && Math.abs((curPov.heading ?? 0) - streetView.heading) > 2) {
      updatingFromMapRef.current = true;
      pano.setPov({
        heading: streetView.heading,
        pitch: streetView.pitch,
      });
      updatingFromMapRef.current = false;
    }
  }, [streetView.lat, streetView.lng, streetView.heading, streetView.pitch, onUpdateStreetView]);

  // Find nearest hydraulic node & pipe to display alongside Street View
  const nearestContext = React.useMemo(() => {
    const lats = nodes.columns.lat;
    const lngs = nodes.columns.lng;
    let bestNode = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.count; i++) {
      const dy = lats[i] - streetView.lat;
      const dx = (lngs[i] - streetView.lng) * 0.82;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestNode = i;
      }
    }

    let bestPipe: number | null = null;
    if (pipes) {
      const uArr = pipes.u;
      const vArr = pipes.v;
      for (let i = 0; i < pipes.count; i++) {
        if (uArr[i] === bestNode || vArr[i] === bestNode) {
          bestPipe = i;
          break;
        }
      }
    }
    return { nodeIdx: bestNode, pipeIdx: bestPipe };
  }, [nodes, pipes, streetView.lat, streetView.lng]);

  const compassDir = (deg: number) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  };

  const nIdx = nearestContext.nodeIdx;
  const pIdx = nearestContext.pipeIdx;

  return (
    <section className="streetview-pane" aria-label="Google Street View Pane">
      <header className="streetview-header">
        <div className="sv-title-cluster">
          <span className="sv-badge">STREET VIEW</span>
          <div>
            <div className="sv-address">
              {streetView.description || 'Lakeridge Dr, Fayetteville, NC'}
            </div>
            <div className="sv-coords">
              {streetView.lat.toFixed(5)}, {streetView.lng.toFixed(5)} • Heading{' '}
              {Math.round(streetView.heading)}° ({compassDir(streetView.heading)})
            </div>
          </div>
        </div>

        <div className="sv-hyd-chip">
          <span>
            Nearest Node <strong>{nodes.columns.id[nIdx]}</strong>:{' '}
            {nodes.columns.p68[nIdx].toFixed(1)} psi •{' '}
            {nodes.columns.ff[nIdx].toFixed(0)} gpm
          </span>
          {pipes && pIdx !== null && (
            <span>
              Pipe <strong>{pipes.id[pIdx]}</strong>: {pipes.diam[pIdx]}"{' '}
              {formatPipeMaterial(pipes.mat[pIdx])}
            </span>
          )}
        </div>

        <button
          type="button"
          className="sv-close-btn"
          onClick={onClose}
          title="Close Street View split pane"
        >
          ✕ Close Street View
        </button>
      </header>

      {statusMsg && <div className="sv-status-banner">{statusMsg}</div>}

      <div ref={panoContainerRef} className="streetview-pano-canvas" />
    </section>
  );
};
