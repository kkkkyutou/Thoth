import type {
  ClarifyConvergenceAudit,
  ContractPreservationAudit,
} from "@thoth/protocol/thoth-runtime-contract";

interface Waiter<T> {
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const waiters = new Map<string, Waiter<ClarifyConvergenceAudit>>();
const contractWaiters = new Map<string, Waiter<ContractPreservationAudit>>();

export function waitForClarifyConvergenceAudit(
  agentId: string,
  timeoutMs = 90_000,
): Promise<ClarifyConvergenceAudit> {
  return new Promise((resolve, reject) => {
    const previous = waiters.get(agentId);
    if (previous) {
      clearTimeout(previous.timeout);
      previous.reject(new Error("Clarify convergence audit was replaced."));
    }
    const timeout = setTimeout(() => {
      waiters.delete(agentId);
      reject(new Error("Clarify convergence audit did not submit a result."));
    }, timeoutMs);
    timeout.unref?.();
    waiters.set(agentId, { resolve, reject, timeout });
  });
}

export function resolveClarifyConvergenceAudit(
  agentId: string,
  result: ClarifyConvergenceAudit,
): boolean {
  const waiter = waiters.get(agentId);
  if (!waiter) {
    return false;
  }
  clearTimeout(waiter.timeout);
  waiters.delete(agentId);
  waiter.resolve(result);
  return true;
}

export function rejectClarifyConvergenceAudit(agentId: string, reason: string): void {
  const waiter = waiters.get(agentId);
  if (!waiter) {
    return;
  }
  clearTimeout(waiter.timeout);
  waiters.delete(agentId);
  waiter.reject(new Error(reason));
}

export function waitForContractPreservationAudit(
  agentId: string,
  timeoutMs = 90_000,
): Promise<ContractPreservationAudit> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      contractWaiters.delete(agentId);
      reject(new Error("Contract preservation audit did not submit a result."));
    }, timeoutMs);
    timeout.unref?.();
    contractWaiters.set(agentId, {
      resolve,
      reject,
      timeout,
    });
  });
}

export function resolveContractPreservationAudit(
  agentId: string,
  result: ContractPreservationAudit,
): boolean {
  const waiter = contractWaiters.get(agentId);
  if (!waiter) {
    return false;
  }
  clearTimeout(waiter.timeout);
  contractWaiters.delete(agentId);
  waiter.resolve(result);
  return true;
}

export function rejectContractPreservationAudit(agentId: string, reason: string): void {
  const waiter = contractWaiters.get(agentId);
  if (!waiter) {
    return;
  }
  clearTimeout(waiter.timeout);
  contractWaiters.delete(agentId);
  waiter.reject(new Error(reason));
}
