import { useEffect, useRef } from 'react';
import { NetworkSnapshot, Filter } from '../types';
import { NetworkVisualization } from '../utils/visualization';

interface NetworkCanvasProps {
  snapshot: NetworkSnapshot | null;
  filter: Filter;
}

export function NetworkCanvas({ snapshot, filter }: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizationRef = useRef<NetworkVisualization | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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
    };

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

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
