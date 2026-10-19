import type {AuditOutcome, AuditVia} from '@prisma/client';
import type {Result} from 'ts-results-es';

import {type ApiError, wrapDb} from '@proxy/utils';

import {db} from '.';

export type AuditEntryRow = {
	id: string;
	agentId: string;
	connectionId: string;
	collectionId: string;
	// list, view, create, update or delete, or a command of the collection, such as `send`.
	action: string;
	recordTitle: string | null;
	query: string | null;
	outcome: AuditOutcome;
	via: AuditVia;
	createdAt: Date;
};

/** Logs one request of an agent, and marks the agent active now. */
export async function logAgentRequest(data: {
	orgId: string;
	agentId: string;
	connectionId: string;
	collectionId: string;
	action: string;
	recordTitle: string | null;
	query: string | null;
	outcome: AuditOutcome;
	via: AuditVia;
}): Promise<Result<void, ApiError>> {
	return wrapDb(async () => {
		await db.$transaction([
			db.auditEntry.create({data}),
			db.agent.update({where: {id: data.agentId}, data: {lastActiveAt: new Date()}}),
		]);
	});
}

/** Newest first, optionally only one agent's or one connection's requests. */
export async function listAuditEntries(
	orgId: string,
	filter: {agentId?: string; connectionId?: string},
	take: number,
): Promise<Result<AuditEntryRow[], ApiError>> {
	return wrapDb(() =>
		db.auditEntry.findMany({
			where: {orgId, ...filter},
			orderBy: {createdAt: 'desc'},
			take,
			select: {
				id: true,
				agentId: true,
				connectionId: true,
				collectionId: true,
				action: true,
				recordTitle: true,
				query: true,
				outcome: true,
				via: true,
				createdAt: true,
			},
		}),
	);
}

/** A connection's entries in one collection, such as a custom MCP server's tool runs, each its action and query. */
export async function listCollectionEntries(
	connectionId: string,
	collectionId: string,
): Promise<Result<Array<{id: string; action: string; query: string | null}>, ApiError>> {
	return wrapDb(() =>
		db.auditEntry.findMany({
			where: {connectionId, collectionId},
			select: {id: true, action: true, query: true},
		}),
	);
}
