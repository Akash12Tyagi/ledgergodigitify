import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { ClientModel } from "@/database/models/client.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { ClientEngagementType, ClientStatus } from "@/constants/domain";

export async function findClientById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return ClientModel.findById(id).lean();
}

export async function findClientsByIds(ids: string[]) {
  await db();
  const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
  return ClientModel.find({ _id: { $in: validIds } }).lean();
}

/** Section 6.6 step 1 — case-insensitive exact match among non-archived
 * clients. Not an error if found; the caller (checkClientNameAction)
 * turns this into a pre-submit warning, never a hard block. */
export async function findClientByNameCaseInsensitive(name: string) {
  await db();
  return ClientModel.findOne({
    name: { $regex: `^${escapeRegExp(name.trim())}$`, $options: "i" },
    status: { $ne: "archived" },
  }).lean();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type InsertClientInput = {
  name: string;
  service: string;
  engagementType: ClientEngagementType;
  amountPaise: number;
  nextDueDate: Date;
  billingDay?: number | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  gstin?: string | null;
  notes?: string | null;
  createdBy: string;
};

export async function insertClient(input: InsertClientInput, session?: ClientSession) {
  await db();
  const [doc] = await ClientModel.create(
    [
      {
        name: input.name,
        service: input.service,
        engagementType: input.engagementType,
        amountPaise: input.amountPaise,
        nextDueDate: input.nextDueDate,
        billingDay: input.billingDay ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
        address: input.address ?? null,
        gstin: input.gstin ?? null,
        notes: input.notes ?? null,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    session ? { session } : undefined
  );
  return assertCreated(doc, "client");
}

/** Section 6.7 — optimistic lock. Null result means either the client
 * doesn't exist or `version` is stale (someone else updated it first);
 * the service can't tell which without a second read, and per spec both
 * cases surface the same CONFLICT message. */
export async function updateClientOptimistic(
  id: string,
  version: number,
  fields: Record<string, unknown>
) {
  await db();
  return ClientModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), version },
    { $set: fields, $inc: { version: 1 } },
    { returnDocument: "after" }
  ).lean();
}

export async function setClientStatus(
  id: string,
  status: ClientStatus,
  extra: { archivedAt?: Date | null; archiveReason?: string | null } = {}
) {
  await db();
  return ClientModel.findByIdAndUpdate(
    id,
    { $set: { status, ...extra } },
    { returnDocument: "after" }
  ).lean();
}

export type ClientListFilter = {
  search?: string;
  status?: ClientStatus | "all";
  engagementType?: ClientEngagementType | "all";
};

/** Section 6.8A — the rollover cron's active-client scan. Only active
 * retainer clients get a new MonthlyBilling each month; one-time clients
 * are billed exactly once at creation (Section 14 edge case 16: a paused
 * client is skipped by the status:"active" filter, not back-billed on
 * resume). */
export async function findActiveRetainerClients() {
  await db();
  return ClientModel.find({ status: "active", engagementType: "retainer" }).lean();
}

export async function findClientsFiltered(filter: ClientListFilter) {
  await db();
  const match: Record<string, unknown> = {};
  if (filter.status && filter.status !== "all") match.status = filter.status;
  else if (!filter.status) match.status = "active"; // Section 7.2 default
  if (filter.engagementType && filter.engagementType !== "all") {
    match.engagementType = filter.engagementType;
  }
  if (filter.search?.trim()) {
    match.$text = { $search: filter.search.trim() };
  }
  return ClientModel.find(match).sort({ name: 1 }).lean();
}
