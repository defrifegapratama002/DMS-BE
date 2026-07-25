export function isPrismaKnownError(error: unknown): error is { code: string; meta?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error;
}