const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function formatWorkflowTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "—" : dateTimeFormatter.format(time) + " WIB";
}

export function jakartaDateTime() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date());
}

export function dispositionDeadline(date?: string | null, time?: string | null) {
  if (!date) return "—";
  const day = date.slice(0, 10);
  const label = new Date(day + "T00:00:00+07:00").toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
  });
  return time ? label + " · " + time.slice(0, 5) + " WIB" : label;
}
