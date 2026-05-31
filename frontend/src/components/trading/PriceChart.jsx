import { useEffect, useRef } from "react";

import { fmt } from "../../lib/format";

export function PriceChart({ points, positive }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;
    const pad = 28;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;

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
      const y = pad + ((height - pad * 2) / 4) * index;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.beginPath();
    points.forEach((point, index) => {
      const x = pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((point - min) / span) * (height - pad * 2);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });

    context.strokeStyle = positive ? "#2ada9e" : "#ff5b6e";
    context.lineWidth = 2.5;
    context.stroke();

    context.lineTo(width - pad, height - pad);
    context.lineTo(pad, height - pad);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.fillStyle = "#8c9aa7";
    context.font = "12px Inter, system-ui";
    context.fillText(fmt(max), width - 96, 20);
    context.fillText(fmt(min), width - 96, height - 12);
  }, [points, positive]);

  return <canvas className="price-chart" ref={canvasRef} width="920" height="420" />;
}
