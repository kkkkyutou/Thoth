import type { ProviderPhaseRecoveryAdapter } from "../provider-phase-recovery.js";
import { codexPhaseRecoveryAdapter } from "./codex-phase-recovery.js";

/** Registry of provider-owned persisted-session recovery adapters. */
export const PROVIDER_PHASE_RECOVERY_ADAPTERS: readonly ProviderPhaseRecoveryAdapter[] = [
  codexPhaseRecoveryAdapter,
];
