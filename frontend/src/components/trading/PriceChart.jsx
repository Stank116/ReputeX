import { useEffect, useMemo, useRef, useState } from "react";

import { fmt } from "../../lib/format";

export function PriceChart({ points, positive }) {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);

  const candles = useMemo(() => {
    const groupSize = Math.max(2, Math.round(4 / zoom));
    const grouped = [];
    for (let index = 0; index < points.length; index += groupSize) {
      const slice = points.slice(index, index + groupSize);
      if (!slice.length) continue;
      const open = slice[0];
      const close = slice.at(-1);
      const high = Math.max(...slice);
      const low = Math.min(...slice);
      const move = Math.abs(close - open);
      const volume = Math.max(80, move * 18 + high * 0.018 + ((index % 7) + 1) * 34);
      grouped.push({ open, high, low, close, volume });
    }
    const visibleCount = Math.max(18, Math.floor(grouped.length / zoom));
    const maxPan = Math.max(grouped.length - visibleCount, 0);
    const start = Math.min(Math.max(pan, 0), maxPan);
    return grouped.slice(start, start + visibleCount);
  }, [pan, points, zoom]);

  const ma = useMemo(
    () =>
      candles.map((_, index) => {
        const window = candles.slice(Math.max(0, index - 6), index + 1);
        return window.reduce((sum, candle) => sum + candle.close, 0) / window.length;
      }),
    [candles]
  );

  const rsi = useMemo(() => {
    let gains = 0;
    let losses = 0;
    for (let index = Math.max(1, candles.length - 14); index < candles.length; index += 1) {
      const diff = candles[index].close - candles[index - 1].close;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (!losses) return gains ? 100 : 50;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }, [candles]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;
    const pad = 28;
    const chartBottom = height - 92;
    const volumeTop = height - 72;
    const min = Math.min(...candles.map((candle) => candle.low));
    const max = Math.max(...candles.map((candle) => candle.high));
    const span = max - min || 1;
    const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, positive ? "rgba(42, 218, 158, 0.16)" : "rgba(255, 91, 110, 0.16)");
    gradient.addColorStop(1, "rgba(8, 11, 14, 0)");

    context.fillStyle = "#080b0e";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#1e2a32";
    context.lineWidth = 1;

    for (let index = 0; index < 5; index += 1) {
      const y = pad + ((chartBottom - pad) / 4) * index;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const scaleY = (price) => chartBottom - ((price - min) / span) * (chartBottom - pad);
    const xFor = (index) => pad + (index / Math.max(candles.length - 1, 1)) * (width - pad * 2);
    const slot = (width - pad * 2) / Math.max(candles.length, 1);
    const bodyWidth = Math.max(5, Math.min(18, slot * 0.58));

    candles.forEach((candle, index) => {
      const x = xFor(index);
      const up = candle.close >= candle.open;
      const color = up ? "#2ada9e" : "#ff5b6e";
      const highY = scaleY(candle.high);
      const lowY = scaleY(candle.low);
      const openY = scaleY(candle.open);
      const closeY = scaleY(candle.close);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
      const volumeHeight = (candle.volume / maxVolume) * 54;

      context.fillStyle = up ? "rgba(42, 218, 158, 0.2)" : "rgba(255, 91, 110, 0.2)";
      context.fillRect(x - bodyWidth / 2, height - 22 - volumeHeight, bodyWidth, volumeHeight);
      context.strokeStyle = color;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(x, highY);
      context.lineTo(x, lowY);
      context.stroke();
      context.fillStyle = color;
      context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
    });

    context.beginPath();
    ma.forEach((point, index) => {
      const x = xFor(index);
      const y = scaleY(point);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "#f4c456";
    context.lineWidth = 1.7;
    context.stroke();

    context.fillStyle = "#8c9aa7";
    context.font = "12px Inter, system-ui";
    context.fillText(fmt(max), width - 96, 20);
    context.fillText(fmt(min), width - 96, chartBottom + 16);
    context.fillText("Volume", pad, volumeTop - 8);
    context.fillStyle = positive ? "#2ada9e" : "#ff5b6e";
    context.fillText(`RSI ${rsi.toFixed(0)}`, pad + 76, volumeTop - 8);
    context.fillStyle = "#f4c456";
    context.fillText("MA 7", pad + 136, volumeTop - 8);
  }, [candles, ma, positive, rsi]);

  return (
    <div className="chart-shell">
      <canvas className="price-chart" ref={canvasRef} width="920" height="420" />
      <div className="chart-controls" aria-label="Chart controls">
        <button type="button" onClick={() => setPan((value) => Math.max(value - 4, 0))}>
          Pan left
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(value - 0.5, 1))}>
          Zoom out
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.min(value + 0.5, 3))}>
          Zoom in
        </button>
        <button type="button" onClick={() => setPan((value) => value + 4)}>
          Pan right
        </button>
      </div>
    </div>
  );
}
