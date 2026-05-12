import { formatDistanceToNow, isYesterday, format } from "date-fns";

export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  if (isYesterday(date)) {
    return "yesterday";
  }

  // If older than 2 days, show absolute date like "Mar 10"
  if (now.getTime() - date.getTime() > 2 * 24 * 60 * 60 * 1000) {
    return format(date, "MMM d");
  }

  return formatDistanceToNow(date, { addSuffix: true })
    .replace("about ", "")
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" days", "d")
    .replace(" day", "d");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
