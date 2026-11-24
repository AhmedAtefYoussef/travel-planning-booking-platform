/** "2h 15m" for a flight duration in minutes (FLT-17). */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "+1" when the local arrival date is after the local departure date, else "". */
export function dayShift(departureLocal: string, arrivalLocal: string): string {
  const diff =
    (Date.parse(arrivalLocal.slice(0, 10)) -
      Date.parse(departureLocal.slice(0, 10))) /
    86_400_000;
  if (diff === 0 || Number.isNaN(diff)) return '';
  return diff > 0 ? `+${diff}` : `${diff}`;
}
