export const fmt = (value, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);

export const pct = (value) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const shortKey = (value) => {
  const text = typeof value === "string" ? value : value?.toBase58?.() ?? "";
  return text ? `${text.slice(0, 4)}...${text.slice(-4)}` : "Not connected";
};

export const safeJson = (value) =>
  JSON.stringify(
    value,
    (_key, entry) => {
      if (typeof entry === "bigint") return entry.toString();
      if (entry?.toBase58) return entry.toBase58();
      if (entry?.constructor?.name === "BN") return entry.toString();
      if (entry instanceof Uint8Array) return Array.from(entry);
      return entry;
    },
    2
  );
