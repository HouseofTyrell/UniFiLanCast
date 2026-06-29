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
}

export function NetworkCanvas({ snapshot, filter, selectedId, onSelect, colorMode }: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizationRef = useRef<NetworkVisualization | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const visualization = new NetworkVisualization(canvas);
    visualizationRef.current = visualization;

    const handleResize = () => {
      visualization.resize();
    };

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

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
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
    if (!visualizationRef.current || !snapshot) return;

    const animate = () => {
      if (visualizationRef.current && snapshot) {
        visualizationRef.current.render(
          snapshot.devices,
          snapshot.links,
          snapshot.weather,
          filter
        );
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [snapshot, filter]);

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
