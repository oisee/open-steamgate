// Mask volatile identities only: protocol names, namespace URIs and coordinates survive.
const fields = 'host|hostname|systemID|userName|user|changedBy|createdBy|client|timestamp|changed|created|etag|lockHandle|lock-handle|LOCK_HANDLE|sessionID|session_id|session-id|generationId|generation_id|generation-id';
const volatile = new RegExp(`^(?:${fields})$`, 'i');
export function mask(value, kind) {
  const text = String(value);
  return /lock|session|generation|etag/i.test(kind) ? '*'.repeat(text.length) : `{${kind.toLowerCase()}}`;
}
export function normalize(value, options = {}) {
  if (Array.isArray(value)) return value.map(v => normalize(v, options));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, volatile.test(k) ? mask(v, k) : normalize(v, options)]));
  if (typeof value !== 'string') return value;
  let result = value;
  if (options.host) result = result.replaceAll(options.host, '{host}');
  for (const [key, replacement] of Object.entries(options.values ?? {})) result = result.replaceAll(key, replacement);
  result = result.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g, '{timestamp}');
  result = result.replace(new RegExp(`(<((?:[\\w.-]+:)?(${fields}))(?:\\s[^>]*)?>)([^<]*)(<\\/\\2>)`, 'gi'),
    (_, open, name, kind, text, close) => open + mask(text, kind) + close);
  result = result.replace(new RegExp(`((?:[\\w.-]+:)?(${fields})\\s*=\\s*)(["'])(.*?)\\3`, 'gi'),
    (_, open, kind, quote, text) => open + quote + mask(text, kind) + quote);
  return result;
}
