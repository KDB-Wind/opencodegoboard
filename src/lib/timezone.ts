export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const STORAGE_KEY = 'opencodegoboard-timezone';

export function getStoredTimezone(): string {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_TIMEZONE;
}

export function storeTimezone(timezone: string): void {
  localStorage.setItem(STORAGE_KEY, timezone);
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const values = intl.supportedValuesOf?.('timeZone') ?? [
    'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Kolkata',
    'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
  ];
  return [...new Set([DEFAULT_TIMEZONE, 'UTC', ...values])];
}
