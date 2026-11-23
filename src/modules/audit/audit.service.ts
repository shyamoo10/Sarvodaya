import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { parsePagination } from '../../lib/http';
import type { AuditLogQuery } from './audit.schemas';

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  requestId?: string | null;
};

/**
 * One append-only row per admin change. Rows are never edited or deleted, so the
 * owner can always answer "who changed this price, and when".
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const actor = entry.actorId
    ? await prisma.user.findUnique({
        where: { id: entry.actorId },
        select: { name: true, phone: true },
      })
    : null;

  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorName: actor?.name ?? null,
      actorPhone: actor?.phone ?? null,
      action: entry.action.slice(0, 60),
      entityType: entry.entityType.slice(0, 40),
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? null,
      metadata: entry.metadata ?? Prisma.JsonNull,
      ipAddress: entry.ipAddress ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}

export async function listAuditLogs(query: AuditLogQuery) {
  const { page, limit, skip } = parsePagination(query);
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to) createdAt.lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
    ...(query.from || query.to ? { createdAt } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip, take: limit }),
  ]);

  return { items, total, page, limit };
}

export function serializeAuditLog(entry: {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorPhone: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  metadata: Prisma.JsonValue | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: Date;
}) {
  return {
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata: entry.metadata,
    actor: entry.actorId ? { id: entry.actorId, name: entry.actorName, phone: entry.actorPhone } : null,
    ipAddress: entry.ipAddress,
    requestId: entry.requestId,
    createdAt: entry.createdAt.toISOString(),
  };
}
