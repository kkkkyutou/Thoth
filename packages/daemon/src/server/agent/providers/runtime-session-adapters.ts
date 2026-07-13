import type { ProviderRuntimeSessionAdapter } from "../provider-runtime-session.js";
import { codexRuntimeSessionAdapter } from "./codex-runtime-session.js";

/** Registry of provider-owned process/session setup adapters. */
export const PROVIDER_RUNTIME_SESSION_ADAPTERS: readonly ProviderRuntimeSessionAdapter[] = [
  codexRuntimeSessionAdapter,
];
