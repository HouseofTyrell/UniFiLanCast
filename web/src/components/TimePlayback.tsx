import { useState, useEffect } from 'react';
import { HistorySample } from '../types';
import './TimePlayback.css';

interface TimePlaybackProps {
  history: HistorySample[];
  onFetchHistory: (minutes: number) => void;
  onSnapshotChange: (snapshot: HistorySample | null) => void;
}

export function TimePlayback({
  history,
  onFetchHistory,
  onSnapshotChange,
}: TimePlaybackProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (history.length > 0) {
      setCurrentIndex(history.length - 1);
    }
  }, [history.length]);

  useEffect(() => {
    if (!isPlaying || history.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex(prev => {
        const next = prev + 1;
        if (next >= history.length) {
          setIsPlaying(false);
          return prev;
        }
        return next;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, history.length]);

  useEffect(() => {
    if (history.length > 0 && currentIndex < history.length) {
      onSnapshotChange(history[currentIndex]);
    } else {
      onSnapshotChange(null);
    }
  }, [currentIndex, history, onSnapshotChange]);

  const handleLoadHistory = (minutes: number) => {
    onFetchHistory(minutes);
    setIsExpanded(true);
  };

  const handlePlay = () => {
    if (currentIndex >= history.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(history.length - 1);
    onSnapshotChange(null);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div className="time-playback">
      <div className="playback-header">
        <button
          className="playback-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '▼' : '▲'} Time Playback
        </button>
      </div>

      {isExpanded && (
        <div className="playback-content">
          <div className="playback-buttons">
            <button onClick={() => handleLoadHistory(15)}>Load 15m</button>
            <button onClick={() => handleLoadHistory(30)}>Load 30m</button>
            <button onClick={() => handleLoadHistory(60)}>Load 1h</button>
          </div>

          {history.length > 0 && (
            <>
              <div className="playback-controls">
                {!isPlaying ? (
                  <button onClick={handlePlay}>▶ Play</button>
                ) : (
                  <button onClick={handlePause}>⏸ Pause</button>
                )}
                <button onClick={handleReset}>⏹ Live</button>
              </div>

              <div className="playback-slider">
                <input
                  type="range"
                  min={0}
                  max={history.length - 1}
                  value={currentIndex}
                  onChange={e => {
                    setIsPlaying(false);
                    setCurrentIndex(parseInt(e.target.value));
                  }}
                />
              </div>

              <div className="playback-info">
                <span>
                  {currentIndex + 1} / {history.length}
                </span>
                {history[currentIndex] && (
                  <span>{formatTime(history[currentIndex].timestamp)}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
