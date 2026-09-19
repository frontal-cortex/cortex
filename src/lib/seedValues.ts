// What a view's filter seeds a new row with. A table filtered `workout ==
// @this` on a workout's page adds sets to that workout; one filtered
// `date == @today` adds today's row. Without this the row would carry the
// literal "@this". Pure, so it is tested without a DOM (seedValues.test.ts).

const MS_DAY = 86_400_000;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The `@word±n` vocabulary of filters (`cortex_core::placeholders`), as far as
 *  a seed needs it: a day, a week's Monday, a month, a year. */
export function resolveAtWord(word: string, now: Date): string | null {
  const m = word.match(/^@([a-z]+)([+-]\d+)?$/i);
  if (!m) return null;
  const offset = Number(m[2] ?? 0);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (m[1].toLowerCase()) {
    case "today": case "date": case "now": return iso(new Date(d.getTime() + offset * MS_DAY));
    case "tomorrow": return iso(new Date(d.getTime() + (1 + offset) * MS_DAY));
    case "yesterday": return iso(new Date(d.getTime() - (1 - offset) * MS_DAY));
    case "monday": case "sunday": {
      const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * MS_DAY + offset * 7 * MS_DAY);
      return iso(m[1].toLowerCase() === "monday" ? monday : new Date(monday.getTime() + 6 * MS_DAY));
    }
    case "month": {
      const x = new Date(d.getFullYear(), d.getMonth() + offset, 1);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    }
    case "year": return String(d.getFullYear() + offset);
    default: return null;
  }
}

/** One seeded value: `@this` is the page the view sits on, an `@` date word is
 *  that date, anything else is itself. */
export function resolveSeedValue(raw: string, here: string, now: Date = new Date()): string {
  const value = raw.trim();
  if (/^@this$/i.test(value)) return here;
  return resolveAtWord(value, now) ?? value;
}
