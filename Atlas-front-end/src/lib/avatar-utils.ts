/**
 * src/lib/avatar-utils.ts
 *
 * Replaces the old placeholder-images.json + placeholder-images.ts mock data.
 *
 * Employee avatars come from the backend (WazuhEvent.avatar field).
 * When the backend supplies an empty or missing avatar URL, these utilities
 * generate a deterministic colour + initials fallback — no hardcoded URLs.
 */

/** Return up to 2 uppercase initials from a full name. */
export function getInitials(name: string): string {
  if (!name || typeof name !== 'string') return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Deterministic HSL background colour derived from the name string. */
export function getAvatarColor(name: string): string {
  if (!name) return 'hsl(220, 20%, 30%)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 35%)`;
}

/**
 * Returns true when the avatar string is a usable remote URL.
 * Empty strings, "N/A", and relative paths are treated as missing.
 */
export function isValidAvatarUrl(avatar: string | undefined | null): boolean {
  if (!avatar || typeof avatar !== 'string') return false;
  return avatar.startsWith('http://') || avatar.startsWith('https://');
}
