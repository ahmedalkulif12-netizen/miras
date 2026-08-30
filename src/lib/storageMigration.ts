/** Read a storage key, migrating from a legacy key once if present. */
export function readStorageWithLegacy(
  storage: Storage,
  key: string,
  legacyKey?: string
): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  if (!legacyKey) return null;
  const legacy = storage.getItem(legacyKey);
  if (legacy === null) return null;
  storage.setItem(key, legacy);
  storage.removeItem(legacyKey);
  return legacy;
}
