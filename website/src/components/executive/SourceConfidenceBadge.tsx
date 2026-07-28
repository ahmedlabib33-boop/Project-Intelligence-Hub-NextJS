type SourceConfidenceBadgeProps = {
  confidence?: string | null;
  dataQuality?: number | null;
  lastUpdated?: string | null;
  sourceCount?: number | null;
  compact?: boolean;
};

function normalizeConfidence(value?: string | null) {
  const text = String(value || "").trim();
  if (["High", "Medium", "Low"].includes(text)) return text;
  return "Low";
}

function formatDate(value?: string | null) {
  if (!value) return "No update date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function SourceConfidenceBadge({
  confidence,
  dataQuality,
  lastUpdated,
  sourceCount,
  compact = false
}: SourceConfidenceBadgeProps) {
  const normalized = normalizeConfidence(confidence);
  const quality = typeof dataQuality === "number" && Number.isFinite(dataQuality) ? `${dataQuality.toFixed(1)}%` : "N/A";
  return (
    <span className={`source-confidence-badge confidence-${normalized.toLowerCase()} ${compact ? "compact" : ""}`}>
      <b>{normalized} confidence</b>
      {!compact && <small>{quality} quality | {sourceCount ?? "N/A"} sources | {formatDate(lastUpdated)}</small>}
    </span>
  );
}
