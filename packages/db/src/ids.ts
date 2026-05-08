const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 1 && slug.length <= 63 && SLUG_RE.test(slug);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
