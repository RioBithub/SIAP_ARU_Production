export default function ConfidentialityBadge({ value }: { value?: string }) {
  const color = value === "RAHASIA" ? "red" : value === "PENTING" ? "orange" : "gray";
  return <span className={`badge ${color}`}>{value || "—"}</span>;
}
