export function isNewVersion(value: unknown, currentVersion: string): value is { version: string } {
  if (typeof value !== "object" || value === null || !("version" in value)) return false;
  return typeof value.version === "string" && value.version.trim().length > 0 && value.version !== currentVersion;
}