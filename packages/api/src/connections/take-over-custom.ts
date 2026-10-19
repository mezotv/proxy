import {Result} from 'ts-results-es';
import {z} from 'zod';

import {ApiErr, type ApiError, Do, requirePresent} from '@proxy/utils';
import {listCollectionEntries} from '@proxy/db/audit';
import {listCustomMcpConnections, takeOverConnection, type CustomMcpConnectionRow, type MovedRun} from '@proxy/db/connection';
import {findIntegration, TOOLS_COLLECTION_ID} from '@proxy/integrations';

import {log, serializeError} from '../observability/log';
import {encryptSecret} from '../utils/secret-crypto';
import {readStoredJson} from '../utils/stored-json';
import {builtInForHost} from './built-in-mcp';
import {customCredentialSchema} from './custom/custom-mcp';
import type {BuiltInMcp, ToolParams} from './mcp/built-in';
import type {McpCredential} from './mcp/mcp-oauth';

/**
 * Moving custom MCP connections over to the integration built in since on the same server, every
 * time the api starts: what was connected by address before becomes a connection of the
 * integration, keeping its id, its name and its activity. Its tools' settings become the
 * integration's actions, never allowing more than before, and its tool runs the integration's
 * requests. A sign-in to the server itself carries over, for the account it is for; a token typed
 * in, or none, doesn't, and the connection waits to be signed in to (`needsSignIn`). Done once per
 * connection, however many servers start at once (`takeOverConnection`).
 */

type Grant = {agentId: string; actionId: string; allowed: boolean};

const listedToolsSchema = z.array(z.object({name: z.string()}));

// The tools a custom connection's server last listed, by name.
function listedTools(tools: string | null): string[] {
	const json = Result.wrap((): unknown => JSON.parse(tools ?? '[]'));
	return json.isOk() ? (listedToolsSchema.safeParse(json.value).data ?? []).map((tool) => tool.name) : [];
}

/**
 * What a custom connection's settings become: an action is on, by default or for an agent, only
 * where every tool the server listed that was part of it was; one none of whose tools it listed is
 * off. An agent keeps a setting of its own only where it differs from the default.
 */
export function movedPermissions(builtIn: BuiltInMcp, actionIds: string[], connection: {listed: string[]; defaults: string[]; grants: Grant[]}): {defaults: string[]; grants: Grant[]} {
	const toolsOf = (actionId: string) => Object.keys(builtIn.tools).filter((name) => builtIn.tools[name]?.actions.includes(actionId) && connection.listed.includes(name));
	const allOn = (actionId: string, isOn: (tool: string) => boolean) => toolsOf(actionId).length > 0 && toolsOf(actionId).every(isOn);
	const defaults = actionIds.filter((actionId) => allOn(actionId, (tool) => connection.defaults.includes(tool)));
	const agentIds = [...new Set(connection.grants.map((grant) => grant.agentId))];
	const grants = agentIds.flatMap((agentId) => {
		const own = new Map(connection.grants.filter((grant) => grant.agentId === agentId).map((grant) => [grant.actionId, grant.allowed]));
		return actionIds.flatMap((actionId) => {
			const allowed = allOn(actionId, (tool) => own.get(tool) ?? connection.defaults.includes(tool));
			return allowed === defaults.includes(actionId) ? [] : [{agentId, actionId, allowed}];
		});
	});
	return {defaults, grants};
}

const paramsSchema = z.record(z.string(), z.unknown());

/** A tool run as the integration logs its own requests; null for a tool it has nothing for, which stays a tool run. */
export function movedRun(builtIn: BuiltInMcp, entry: {id: string; action: string; query: string | null}): MovedRun | null {
	const run = builtIn.tools[entry.action]?.run;
	if (!run) {
		return null;
	}
	// Params cut short in the log aren't JSON any more, and are left out.
	const json = Result.wrap((): unknown => JSON.parse(entry.query ?? 'null'));
	const params: ToolParams = json.isOk() ? (paramsSchema.safeParse(json.value).data ?? null) : null;
	const moved = run(params);
	return {id: entry.id, collectionId: moved.collectionId, action: moved.operation, recordTitle: moved.title ?? null, query: moved.query ?? null};
}

// The address without its query, as the server's own is written.
function serverAddress(url: string): string | null {
	return URL.canParse(url) ? `${new URL(url).origin}${new URL(url).pathname.replace(/\/$/, '')}` : null;
}

/**
 * The credential of a custom connection signed in to the integration's own server, through its
 * own authorization server, as the integration keeps one; null for one with a token typed in, or
 * none, or signed in to elsewhere, which has to be signed in to again.
 */
export function movedCredential(builtIn: BuiltInMcp, stored: string | null): McpCredential | null {
	const read = readStoredJson(stored ?? '', customCredentialSchema);
	if (read.isErr() || read.value.auth !== 'oauth') {
		return null;
	}
	const custom = read.value;
	if (serverAddress(custom.url) !== serverAddress(builtIn.server.url) || custom.server.tokenUrl !== builtIn.server.tokenUrl) {
		return null;
	}
	return {clientId: custom.clientId, accessToken: custom.accessToken, refreshToken: custom.refreshToken, expiresAt: custom.expiresAt};
}

/** Moves one custom connection over; `Ok(false)` when another server already did. */
export function takeOver(connection: CustomMcpConnectionRow, builtIn: BuiltInMcp): Promise<Result<boolean, ApiError>> {
	return Do(async ($) => {
		const integration = $(requirePresent(findIntegration(builtIn.integrationId), ApiErr.internalError(new Error(`No integration ${builtIn.integrationId}`))));
		const credential = movedCredential(builtIn, connection.credential);
		// The account the sign-in is for, as signing in again finds it; else the server's address,
		// until it is signed in to.
		const account = credential ? (await builtIn.account({credential, workspaceName: null})).unwrapOr(connection.account) : connection.account;
		const permissions = movedPermissions(
			builtIn,
			integration.actions.map((action) => action.id),
			{listed: listedTools(connection.tools), defaults: connection.defaults.map((stored) => stored.actionId), grants: connection.agentGrants},
		);
		const entries = $(await listCollectionEntries(connection.id, TOOLS_COLLECTION_ID));
		return $(
			await takeOverConnection({
				connectionId: connection.id,
				integrationId: builtIn.integrationId,
				account,
				credential: credential ? $(encryptSecret(JSON.stringify(credential))) : null,
				...permissions,
				runs: entries.flatMap((entry) => movedRun(builtIn, entry) ?? []),
			}),
		);
	});
}

/** Moves every custom MCP connection an integration takes over, logging each. */
export async function takeOverCustomConnections(): Promise<void> {
	const connections = await listCustomMcpConnections();
	if (connections.isErr()) {
		log.error('Listing custom MCP connections to move over failed', 'cause' in connections.error ? serializeError(connections.error.cause) : {kind: connections.error.kind});
		return;
	}
	for (const connection of connections.value) {
		// A custom connection's account is its server's address, host first: "mcp.linear.app/mcp".
		const builtIn = builtInForHost(connection.account.split('/')[0] ?? '');
		if (!builtIn) {
			continue;
		}
		const moved = await takeOver(connection, builtIn);
		if (moved.isErr()) {
			log.warn('Moving a custom MCP connection over failed', {
				connectionId: connection.id,
				integrationId: builtIn.integrationId,
				kind: moved.error.kind,
				...('cause' in moved.error ? serializeError(moved.error.cause) : {}),
			});
			continue;
		}
		if (moved.value) {
			log.info('Moved a custom MCP connection over', {connectionId: connection.id, integrationId: builtIn.integrationId});
		}
	}
}
