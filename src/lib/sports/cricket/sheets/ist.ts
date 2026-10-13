/**
 * Fixture start times. The sheet gives Indian Standard Time (UTC+5:30, no daylight saving); the
 * database stores UTC. Accepts what a spreadsheet is likely to hold:
 *
 *   2026-04-12 19:30        ISO-style (what the template uses)
 *   12/04/2026 7:30 PM      day first, as written in India (also with - or .)
 *   46124.8125              an Excel date-time serial (a date-formatted cell read raw)
 *
 * plus an optional separate time column ("19:30", "7:30 PM", or an Excel time fraction).
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IstParse {
  /** The instant in UTC. */
  date: Date;
  /** False when no time was given anywhere; the time is then 00:00 IST. */
  hasTime: boolean;
}

interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  hasTime: boolean;
}

function validWall(w: Wall): boolean {
  if (w.m < 1 || w.m > 12 || w.d < 1 || w.hh < 0 || w.hh > 23 || w.mm < 0 || w.mm > 59) return false;
  const daysInMonth = new Date(Date.UTC(w.y, w.m, 0)).getUTCDate();
  return w.d <= daysInMonth && w.y >= 2000 && w.y <= 2100;
}

/** "19:30", "7:30 PM", "7 pm" → [hours, minutes]; null if not a time. */
export function parseClock(text: string): [number, number] | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase().replace(/\./g, "");
  if (!m[2] && !ampm) return null; // a bare "7" is not a time
  if (ampm) {
    if (hh < 1 || hh > 12) return null;
    if (ampm === "pm" && hh !== 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;
  }
  if (hh > 23 || mm > 59) return null;
  return [hh, mm];
}

function wallFromSerial(serial: number): Wall {
  const ms = Math.round((serial * DAY_MS) / 60000) * 60000; // to the minute
  const d = new Date(EXCEL_EPOCH_MS + ms);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    hasTime: serial % 1 !== 0,
  };
}

function wallFromText(text: string): Wall | null {
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(.+))?$/);
  let wall: Wall | null = null;
  let clock: string | undefined;
  if (m) {
    wall = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hh: 0, mm: 0, hasTime: false };
    clock = m[4];
  } else {
    m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,]+(.+))?$/);
    if (!m) return null;
    wall = { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]), hh: 0, mm: 0, hasTime: false };
    clock = m[4];
  }
  if (clock !== undefined) {
    const parsed = parseClock(clock.replace(/\s*(ist|hrs|h)$/i, ""));
    if (!parsed) return null;
    [wall.hh, wall.mm] = parsed;
    wall.hasTime = true;
  }
  return wall;
}

/**
 * Parse a fixture start (and optional separate time cell) given in IST. Null when the date can't be
 * read; the caller reports that as an error.
 */
export function parseIstDateTime(value: unknown, timeValue?: unknown): IstParse | null {
  let wall: Wall | null = null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    wall = wallFromSerial(value);
  } else if (typeof value === "string" && value.trim()) {
    wall = wallFromText(value.trim().replace(/\s+/g, " "));
  }
  if (!wall) return null;

  // A separate time cell fills in (or overrides) the time of day.
  if (timeValue !== undefined && timeValue !== null && timeValue !== "") {
    if (typeof timeValue === "number" && Number.isFinite(timeValue) && timeValue >= 0 && timeValue < 1) {
      const minutes = Math.round(timeValue * 24 * 60);
      wall.hh = Math.floor(minutes / 60) % 24;
      wall.mm = minutes % 60;
      wall.hasTime = true;
    } else {
      const parsed = parseClock(String(timeValue));
      if (!parsed) return null;
      [wall.hh, wall.mm] = parsed;
      wall.hasTime = true;
    }
  }
  if (!validWall(wall)) return null;
  const utc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm) - IST_OFFSET_MS;
  return { date: new Date(utc), hasTime: wall.hasTime };
}

/** "2026-04-12 19:30" in IST, for previews and tables. */
export function formatIst(date: Date): string {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
