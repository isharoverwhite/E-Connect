const UTC_NAIVE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

type ServerTimestampFormatArgs = {
  fallback?: string;
  locale?: Intl.LocalesArgument;
  options: Intl.DateTimeFormatOptions;
  timezone?: string | null;
};

function normalizeApiTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return UTC_NAIVE_TIMESTAMP_PATTERN.test(trimmed) ? `${trimmed}Z` : trimmed;
}

export function parseApiTimestamp(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(normalizeApiTimestamp(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatServerTimestamp(
  value: string | null | undefined,
  {
    fallback = "Unknown",
    locale,
    options,
    timezone,
  }: ServerTimestampFormatArgs,
): string {
  const parsed = parseApiTimestamp(value);
  if (!parsed) {
    return value ? value : fallback;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(parsed);
  }
}
