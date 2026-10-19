import type {Response} from 'express';
import type {Result} from 'ts-results-es';
import {z} from 'zod';

import {Do, type ApiError} from '@proxy/utils';

import {signInFlow, signInRoutes, type Connected, type SignInRequest} from '../connect-flow';
import type {BuiltInMcp} from './built-in';
import {exchangeMcpCode, mcpAuthorizeUrl, registerMcpClient, type McpCredential, type McpServer} from './mcp-oauth';

/**
 * Connecting an integration by signing in to its MCP server, as Granola, Notion and Linear are, and
 * a custom server by its address, through the sign-in flow every OAuth integration shares
 * (`connect-flow.ts`): the start registers Personal Agent Proxy with the server, keeping the client
 * it registered for the callback, and sends the browser to the server's sign-in.
 */

/**
 * Registers with the server for this sign-in, and its sign-in page, keeping the client for the
 * callback beside `kept`.
 */
export function startMcpSignIn<K extends object>(server: McpServer, {redirectUri, state, challenge}: SignInRequest, kept: K): Promise<Result<{url: string; kept: K & {clientId: string}}, ApiError>> {
	return Do(async ($) => {
		const clientId = $(await registerMcpClient(server, redirectUri));
		return {url: mcpAuthorizeUrl(server, {clientId, redirectUri, state, challenge}), kept: {...kept, clientId}};
	});
}

// The sign-in to an integration built on its MCP server, keeping the name the person gave the
// connection where it began on the custom MCP form.
function builtInSignIn(builtIn: BuiltInMcp) {
	const {server} = builtIn;
	return {
		integrationId: builtIn.integrationId,
		name: server.name,
		keptSchema: z.object({clientId: z.string(), name: z.string().optional()}),
		start: (request: SignInRequest) => startMcpSignIn(server, request, {}),
		finish: ({redirectUri, code, verifier, kept}: {redirectUri: string; code: string; verifier: string; kept: {clientId: string; name?: string}}) =>
			Do<Connected<McpCredential>, ApiError>(async ($) => {
				const signIn = $(await exchangeMcpCode(server, {clientId: kept.clientId, redirectUri, code, verifier}));
				return {account: $(await builtIn.account(signIn)), credential: signIn.credential, defaults: builtIn.defaults, ...(kept.name ? {name: kept.name} : {})};
			}),
	};
}

/**
 * The routes for an integration built on its MCP server, as Granola's is: the start, a top-level
 * navigation, and the callback, which makes the connection for the account the sign-in is for.
 */
export function mcpConnectRoutes(builtIn: BuiltInMcp) {
	return signInRoutes(builtInSignIn(builtIn));
}

/**
 * Begins the sign-in to an integration built on its MCP server from elsewhere than its start
 * route, as the custom MCP form does for the integration's own server, the connection called by
 * `name`; its sign-in page, for the browser to go to, which comes back to the integration's
 * callback.
 */
export function beginBuiltInSignIn(builtIn: BuiltInMcp, res: Response, begin: {userId: string; returnTo: 'welcome' | undefined; name: string}): Promise<Result<string, ApiError>> {
	return signInFlow(builtInSignIn(builtIn)).beginSignIn(res, {
		userId: begin.userId,
		returnTo: begin.returnTo,
		account: null,
		start: (request) => startMcpSignIn(builtIn.server, request, {name: begin.name}),
	});
}
