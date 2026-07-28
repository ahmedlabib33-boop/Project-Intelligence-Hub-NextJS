"use client";

export default function ExecutiveLightModeToggle({
  enabled,
  onChange
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="executive-light-toggle">
      <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
      <span>Executive Light Mode</span>
    </label>
  );
}
