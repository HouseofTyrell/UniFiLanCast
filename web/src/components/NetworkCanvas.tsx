import { useEffect, useRef } from 'react';
import { NetworkSnapshot, Filter } from '../types';
import { NetworkVisualization } from '../utils/visualization';
import { ColorMode } from '../utils/vlan';

interface NetworkCanvasProps {
  snapshot: NetworkSnapshot | null;
  filter: Filter;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  colorMode: ColorMode;
  usageMap: Record<string, { down: number; up: number }>;
}

export function NetworkCanvas({ snapshot, filter, selectedId, onSelect, colorMode, usageMap }: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizationRef = useRef<NetworkVisualization | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Feed the latest snapshot/filter to the single long-lived rAF loop via refs,
  // so the loop isn't torn down and recreated (capturing a stale snapshot) on
  // every SSE update.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const visualization = new NetworkVisualization(canvas);
    visualizationRef.current = visualization;

    const handleResize = () => {
      visualization.resize();
    };

    // Track the stage container's size, not the window.
    const ro = new ResizeObserver(() => visualization.resize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      visualization.handleMouseMove(x, y);
      canvas.style.cursor = visualization.hitTest(x, y) ? 'pointer' : 'default';
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const id = visualization.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      onSelectRef.current(id);
    };

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    // One long-lived render loop; reads the latest snapshot/filter from refs.
    const animate = () => {
      const snap = snapshotRef.current;
      if (snap) {
        visualization.render(snap.devices, snap.links, snap.weather, filterRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      ro.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    visualizationRef.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    visualizationRef.current?.setColorMode(colorMode);
  }, [colorMode]);

  useEffect(() => {
    visualizationRef.current?.setUsageMap(usageMap);
  }, [usageMap]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
      }}
    />
  );
}
