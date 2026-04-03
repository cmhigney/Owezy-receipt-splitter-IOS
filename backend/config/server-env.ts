function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertServerOnlyEnvName(name: string): void {
  if (name.startsWith("EXPO_PUBLIC_")) {
    throw new Error(`Sensitive server config must not use a public Expo env name: ${name}`);
  }
}

export function getOptionalServerEnv(name: string): string | undefined {
  assertServerOnlyEnvName(name);
  return normalizeEnvValue(process.env[name]);
}

export function getOptionalServerSecret(name: string): string {
  return getOptionalServerEnv(name) ?? "";
}
