export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// A host switch intentionally closes outstanding requests from the superseded client.
// That is lifecycle cleanup, not an application or daemon failure.
export function isDaemonClientClosedError(error: unknown): boolean {
  return toErrorMessage(error).trim().toLowerCase() === "daemon client closed";
}
