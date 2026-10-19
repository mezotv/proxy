import type {Result} from 'ts-results-es';

import type {ApiError} from '@proxy/utils';
import type {IntegrationId} from '@proxy/integrations';

import type {McpServer, McpSignIn} from './mcp-oauth';

/**
 * An integration built on its provider's MCP server, as Granola, Notion, Linear, Exa and Parallel
 * are: signed in to through the server (`mcpConnectRoutes`), and taking over the custom MCP
 * connections people made to the same server before it was built in (`take-over-custom.ts`). A
 * custom server at one of its hosts can't be added any more; one already there becomes a connection
 * of the integration, its tools' settings and runs as the integration's actions and requests.
 */

/** Params of a tool run, as the activity log kept them; null when they were cut short, or not kept. */
export type ToolParams = Record<string, unknown> | null;

/** A run of a custom server's tool as the integration logs its own: a collection's list, open, write or command. */
export type MovedToolRun = {collectionId: string; operation: string; title?: string | null; query?: string | null};

/** What one of the server's tools becomes. */
export type MovedTool = {
	// The actions it was part of: one is on only where every tool that was part of it was on, so
	// moving over never allows more than before.
	actions: string[];
	// What a run of it becomes in the activity log; left a tool run without.
	run?: (params: ToolParams) => MovedToolRun;
};

export type BuiltInMcp = {
	integrationId: IntegrationId;
	server: McpServer;
	// Hosts beyond the server's own that are the same service, as Parallel's keyless server.
	otherHosts?: string[];
	// The account a sign-in is for, as the connection shows it: two sign-ins to the same account are
	// the same connection.
	account: (signIn: McpSignIn) => Promise<Result<string, ApiError>>;
	// The actions agents get with a new connection.
	defaults: string[];
	// The server's tools a custom connection was allowed, by name; any other's settings are dropped.
	tools: Record<string, MovedTool>;
};

/** The hosts whose custom MCP servers the integration takes over. */
export function builtInHosts(builtIn: BuiltInMcp): string[] {
	return [new URL(builtIn.server.url).host, ...(builtIn.otherHosts ?? [])];
}

/** A param's text, trimmed; null for anything else. */
export function textParam(params: ToolParams, key: string): string | null {
	const value = params?.[key];
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The first text of a list param, as the first page of `urls`. */
export function firstParam(params: ToolParams, key: string): string | null {
	const value = params?.[key];
	return Array.isArray(value) ? textParam({first: value[0]}, 'first') : null;
}
