import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LayerConfig } from './types';

interface DraggableLegendProps {
  config: LayerConfig;
  binCounts: number[];
  totalJunctions: number;
  hiddenBins: Set<number>;
  onToggleBin: (binIdx: number) => void;
  onShowAllBins: () => void;
  stats: {
    min: number;
    p25: number;
    median: number;
    mean: number;
    p90: number;
    max: number;
  };
  pointSize: number;
  onChangePointSize: (size: number) => void;
}

export const DraggableLegend: React.FC<DraggableLegendProps> = ({
  config,
  binCounts,
  totalJunctions,
  hiddenBins,
  onToggleBin,
  onShowAllBins,
  stats,
  pointSize,
  onChangePointSize,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 12, y: 54 });
  const [collapsed, setCollapsed] = useState(false);
  const dragState = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({
    dragging: false,
    startX: 0,
    startY: 0,
    origX: 12,
    origY: 54,
  });

  const clampPosition = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    const minTop = 52;
    const width = el ? el.offsetWidth : 272;
    const height = el ? el.offsetHeight : 54;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(minTop, window.innerHeight - height - 8);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(minTop, y), maxY),
    };
  }, []);

  useEffect(() => {
    setPosition((prev) => clampPosition(prev.x, prev.y));
    const handleResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  const startDrag = (clientX: number, clientY: number) => {
    dragState.current = {
      dragging: true,
      startX: clientX,
      startY: clientY,
      origX: position.x,
      origY: position.y,
    };
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current.dragging) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setPosition(clampPosition(dragState.current.origX + dx, dragState.current.origY + dy));
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragState.current.dragging || e.touches.length === 0) return;
      const t = e.touches[0];
      const dx = t.clientX - dragState.current.startX;
      const dy = t.clientY - dragState.current.startY;
      setPosition(clampPosition(dragState.current.origX + dx, dragState.current.origY + dy));
    };
    const stopDrag = () => {
      dragState.current.dragging = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stopDrag);
    };
  }, [clampPosition]);

  const visibleCount = binCounts.reduce(
    (acc, c, i) => (hiddenBins.has(i) ? acc : acc + c),
    0
  );

  return (
    <div
      ref={panelRef}
      className="floating-legend"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div
        className="legend-titlebar"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          startDrag(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          if (e.touches.length > 0) {
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        title="Drag to reposition legend"
      >
        <div className="legend-title-group">
          <span className="legend-grip" aria-hidden="true">⋮⋮</span>
          <div>
            <div className="legend-title">{config.title}</div>
            <div className="legend-subtitle">
              {visibleCount.toLocaleString()} / {totalJunctions.toLocaleString()} junctions visible
            </div>
          </div>
        </div>
        <button
          type="button"
          className="legend-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand legend' : 'Collapse legend'}
          aria-label={collapsed ? 'Expand legend' : 'Collapse legend'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div className="legend-body">
          <div className="legend-hint-row">
            <span>Click any tier to filter map</span>
            {hiddenBins.size > 0 && (
              <button type="button" className="legend-reset-link" onClick={onShowAllBins}>
                Show all ({hiddenBins.size} hidden)
              </button>
            )}
          </div>

          <div className="legend-bins">
            {config.bins.map((bin, idx) => {
              const count = binCounts[idx] || 0;
              const pct = totalJunctions > 0 ? (count / totalJunctions) * 100 : 0;
              const isHidden = hiddenBins.has(idx);
              return (
                <button
                  key={bin.id}
                  type="button"
                  className={`legend-bin-row ${isHidden ? 'is-hidden' : ''}`}
                  onClick={() => onToggleBin(idx)}
                >
                  <span
                    className="legend-swatch"
                    style={{
                      backgroundColor: isHidden ? 'transparent' : bin.color,
                      borderColor: bin.color,
                    }}
                  />
                  <div className="legend-bin-main">
                    <div className="legend-bin-top">
                      <span className="legend-bin-label">{bin.label}</span>
                      <span className="legend-bin-count">
                        {count.toLocaleString()}{' '}
                        <span className="legend-bin-pct">({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="legend-bar-track">
                      <div
                        className="legend-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`,
                          backgroundColor: bin.color,
                        }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="legend-stats-grid">
            <div className="stat-cell">
              <span className="stat-label">MIN</span>
              <span className="stat-val">
                {stats.min.toLocaleString(undefined, { maximumFractionDigits: 1 })} {config.unit}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">MEDIAN</span>
              <span className="stat-val">
                {stats.median.toLocaleString(undefined, { maximumFractionDigits: 1 })} {config.unit}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">MEAN</span>
              <span className="stat-val">
                {stats.mean.toLocaleString(undefined, { maximumFractionDigits: 1 })} {config.unit}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">90TH PCT</span>
              <span className="stat-val">
                {stats.p90.toLocaleString(undefined, { maximumFractionDigits: 1 })} {config.unit}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">MAX</span>
              <span className="stat-val">
                {stats.max.toLocaleString(undefined, { maximumFractionDigits: 1 })} {config.unit}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">NODE SIZE</span>
              <input
                type="range"
                min={0.6}
                max={5.4}
                step={0.3}
                value={pointSize}
                onChange={(e) => onChangePointSize( parseFloat(e.target.value) )}
                className="point-size-slider"
              />
            </div>
          </div>

          <div className="legend-facilities-key">
            <div className="facility-key-item">
              <span className="facility-badge reservoir-badge">WTP</span>
              <span>Reservoir (Hoffer, Glenville)</span>
            </div>
            <div className="facility-key-item">
              <span className="facility-badge tank-badge">TK</span>
              <span>Elevated Tank (5 Tanks)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
