export function LiveInput({ label, onChange, placeholder, type = "text", value }) {
  return (
    <label>
      {label}
      <input placeholder={placeholder} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
