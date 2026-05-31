export function Stat({ label, value, tone }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export function Preview({ label, value, tone }) {
  return (
    <div className="preview-row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}
