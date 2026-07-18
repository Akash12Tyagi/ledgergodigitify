import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { formatINR } from "@/lib/money";
import {
  findAccountById,
  findAccountsByIds,
  findActiveAccountByName,
  findAllAccounts,
  findAllActiveAccounts,
  insertAccount,
  setAccountArchived,
  setAccountOpeningBalance,
  unsetAllDefaultAccounts,
  updateAccountOptimistic,
} from "@/server/repositories/accounts.repository";
import { logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { CreateAccountInput, UpdateAccountInput } from "@/schemas/account.schema";

/** Section 7.4/7.6 — recordPayment (M3) needs to list existing accounts to
 * record against; every other read here landed with full account
 * management in Milestone 4. */
export async function listActiveAccounts() {
  return findAllActiveAccounts();
}

/** Section 7.7 — /ledger/accounts shows every account, active or
 * archived (Section 14 edge case 19: an archived account's history stays
 * visible/drillable even though it disappears from AccountSelect). */
export async function listAllAccounts() {
  return findAllAccounts();
}

/** Section 7.4 payment trail — batched account-name lookup (Section 9: no
 * N+1). */
export async function getAccountNamesByIds(ids: string[]): Promise<Map<string, string>> {
  const accounts = await findAccountsByIds(ids);
  return new Map(accounts.map((a) => [a._id.toString(), a.name]));
}

export async function getAccount(accountId: string) {
  const account = await findAccountById(accountId);
  if (!account) throw new AppError("NOT_FOUND", "Account not found");
  return account;
}

/** Section 7.14/14 edge case 24 — the /settings reconciliation panel's
 * data: every account currently locked pending the owner's resolution. */
export async function listLockedAccounts() {
  const accounts = await findAllAccounts();
  return accounts
    .filter((a) => a.reconcileLock)
    .map((a) => ({ id: a._id.toString(), name: a.name, currentBalancePaise: a.currentBalancePaise }));
}

// Section 6.9 — createAccount. The very first account created is forced
// default even if isDefault wasn't checked (an app with zero default
// accounts has no fallback for AccountSelect/dashboard), matching
// isDefault:true's own behavior of unseating every other account.
export async function createAccount(input: CreateAccountInput, actor: AuthedUser) {
  const collision = await findActiveAccountByName(input.name);
  if (collision) {
    throw new AppError("VALIDATION", "An active account with this name already exists.", {
      fields: { name: "Name already in use" },
    });
  }

  const hasNoActiveAccountsYet = (await findAllActiveAccounts()).length === 0;
  const isDefault = input.isDefault === true || hasNoActiveAccountsYet;

  return withDbTransaction(async (session) => {
    if (isDefault) await unsetAllDefaultAccounts(session);

    const account = await insertAccount(
      {
        name: input.name,
        type: input.type,
        openingBalancePaise: input.openingBalancePaise,
        bankName: input.bankName ?? null,
        last4: input.last4 ?? null,
        lowBalanceThresholdPaise: input.lowBalanceThresholdPaise ?? null,
        isDefault,
      },
      session
    );

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action: "ACCOUNT_CREATED",
        entity: { kind: "account", id: account._id },
        after: {
          name: account.name,
          type: account.type,
          openingBalancePaise: account.openingBalancePaise,
          isDefault: account.isDefault,
        },
        summary: `${actor.name} created account "${account.name}" (${account.type})`,
      },
      session
    );

    return account;
  });
}

// Section 6.9 — updateAccount. Bundles three independently-audited
// sub-updates (opening balance / general fields / default flag) so a
// single form submit can touch any combination while each still gets its
// own AuditLog row (Section 13: one entry per fact, not one entry per
// HTTP request).
export async function updateAccount(input: UpdateAccountInput, actor: AuthedUser) {
  const before = await findAccountById(input.accountId);
  if (!before) throw new AppError("NOT_FOUND", "Account not found");

  const { accountId, version, openingBalancePaise, isDefault, ...rest } = input;

  return withDbTransaction(async (session) => {
    let current = before;
    // The caller's claimed version gates the FIRST write below; each
    // subsequent sub-update in this same call re-checks against the
    // version the previous sub-update just returned (not a fresh re-read),
    // so a genuinely stale client-supplied version is rejected immediately
    // instead of silently matching whatever the DB happens to hold now.
    let expectedVersion = version;

    if (openingBalancePaise !== undefined && openingBalancePaise !== current.openingBalancePaise) {
      // Section 14 edge case 23 — owner-only, and only ever reachable if
      // the action layer already gated the role; re-checked here too
      // since this function is unit-tested directly.
      if (actor.role !== "owner") {
        throw new AppError("FORBIDDEN", "Only the owner can change an account's opening balance.");
      }
      const delta = openingBalancePaise - current.openingBalancePaise;
      const updated = await setAccountOpeningBalance(
        accountId,
        expectedVersion,
        openingBalancePaise,
        delta,
        session
      );
      if (!updated) {
        throw new AppError("CONFLICT", "This account was updated by someone else. Refresh and try again.");
      }
      await logAudit(
        {
          actorUserId: actor.id,
          actorName: actor.name,
          action: "ACCOUNT_OPENING_BALANCE_CHANGED",
          entity: { kind: "account", id: updated._id },
          before: {
            openingBalancePaise: current.openingBalancePaise,
            currentBalancePaise: current.currentBalancePaise,
          },
          after: {
            openingBalancePaise: updated.openingBalancePaise,
            currentBalancePaise: updated.currentBalancePaise,
          },
          summary: `${actor.name} changed "${updated.name}"'s opening balance from ${formatINR(current.openingBalancePaise)} to ${formatINR(openingBalancePaise)}`,
        },
        session
      );
      current = updated;
      expectedVersion = updated.version;
    }

    const patch: Record<string, unknown> = {};
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.type !== undefined) patch.type = rest.type;
    if (rest.bankName !== undefined) patch.bankName = rest.bankName;
    if (rest.last4 !== undefined) patch.last4 = rest.last4;
    if (rest.lowBalanceThresholdPaise !== undefined) patch.lowBalanceThresholdPaise = rest.lowBalanceThresholdPaise;

    if (Object.keys(patch).length > 0) {
      if (typeof patch.name === "string" && patch.name !== current.name) {
        const collision = await findActiveAccountByName(patch.name);
        if (collision && collision._id.toString() !== accountId) {
          throw new AppError("VALIDATION", "An active account with this name already exists.", {
            fields: { name: "Name already in use" },
          });
        }
      }
      const updated = await updateAccountOptimistic(accountId, expectedVersion, patch, session);
      if (!updated) {
        throw new AppError("CONFLICT", "This account was updated by someone else. Refresh and try again.");
      }
      await logAudit(
        {
          actorUserId: actor.id,
          actorName: actor.name,
          action: "ACCOUNT_UPDATED",
          entity: { kind: "account", id: updated._id },
          before: current,
          after: updated,
          summary: `${actor.name} updated account "${updated.name}"`,
        },
        session
      );
      current = updated;
      expectedVersion = updated.version;
    }

    if (isDefault === true && !current.isDefault) {
      await unsetAllDefaultAccounts(session);
      const updated = await updateAccountOptimistic(accountId, expectedVersion, { isDefault: true }, session);
      if (!updated) {
        throw new AppError("CONFLICT", "This account was updated by someone else. Refresh and try again.");
      }
      await logAudit(
        {
          actorUserId: actor.id,
          actorName: actor.name,
          action: "ACCOUNT_DEFAULT_CHANGED",
          entity: { kind: "account", id: updated._id },
          before: { isDefault: false },
          after: { isDefault: true },
          summary: `${actor.name} set "${updated.name}" as the default account`,
        },
        session
      );
      current = updated;
    }

    return current;
  });
}

// Section 6.9/14 edge case 18 — archive is only permitted at exactly zero
// balance. setAccountArchived's filter makes the zero-balance check and
// the write atomic; on failure we re-read to report the precise reason.
export async function archiveAccount(accountId: string, actor: AuthedUser) {
  const before = await findAccountById(accountId);
  if (!before) throw new AppError("NOT_FOUND", "Account not found");

  return withDbTransaction(async (session) => {
    const updated = await setAccountArchived(accountId, before.version, session);
    if (!updated) {
      const fresh = await findAccountById(accountId);
      if (!fresh) throw new AppError("NOT_FOUND", "Account not found");
      if (fresh.status === "archived") {
        throw new AppError("CONFLICT", "This account is already archived.");
      }
      if (fresh.currentBalancePaise !== 0) {
        throw new AppError(
          "NONZERO_BALANCE",
          `This account still holds ${formatINR(fresh.currentBalancePaise)}. Transfer it out before archiving.`,
          { data: { balancePaise: fresh.currentBalancePaise } }
        );
      }
      throw new AppError("CONFLICT", "This account was updated by someone else. Refresh and try again.");
    }

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action: "ACCOUNT_ARCHIVED",
        entity: { kind: "account", id: updated._id },
        before,
        after: updated,
        summary: `${actor.name} archived account "${updated.name}"`,
      },
      session
    );

    return updated;
  });
}

/**
 * Section 6.9 — setDefaultAccount, its own action (Section 8.2) rather
 * than folded into updateAccount so a one-click "make default" control
 * doesn't need the whole edit form. Section 14/assumption #46 — the
 * optimistic-lock check on the target account is what surfaces a CONFLICT
 * instead of silently racing two concurrent "make X default" clicks.
 */
export async function setDefaultAccount(accountId: string, actor: AuthedUser) {
  const before = await findAccountById(accountId);
  if (!before) throw new AppError("NOT_FOUND", "Account not found");
  if (before.status !== "active") {
    throw new AppError("VALIDATION", "Only an active account can be the default.");
  }
  if (before.isDefault) return before;

  return withDbTransaction(async (session) => {
    await unsetAllDefaultAccounts(session);
    const updated = await updateAccountOptimistic(accountId, before.version, { isDefault: true }, session);
    if (!updated) {
      throw new AppError("CONFLICT", "This account was updated by someone else. Refresh and try again.");
    }

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action: "ACCOUNT_DEFAULT_CHANGED",
        entity: { kind: "account", id: updated._id },
        before: { isDefault: false },
        after: { isDefault: true },
        summary: `${actor.name} set "${updated.name}" as the default account`,
      },
      session
    );

    return updated;
  });
}
