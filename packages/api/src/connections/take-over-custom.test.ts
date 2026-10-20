import {beforeEach, describe, expect, mock, spyOn, test} from 'bun:test';
import {Ok, type Result} from 'ts-results-es';

import type {ApiError} from '@proxy/utils';

const listCustomMcpConnections = mock();
const takeOverConnection = mock();

mock.module('@proxy/db/connection', () => ({
	listCustomMcpConnections,
	takeOverConnection,
	findAccountConnection: mock(),
	getConnectionWithCredential: mock(),
	createConnection: mock(),
	renewConnection: mock(),
	updateConnectionCredential: mock(),
	getConnectionCredential: mock(async () => Ok(null)),
	updateConnectionTools: mock(),
	updateConnectionName: mock(),
}));

const listCollectionEntries = mock();

mock.module('@proxy/db/audit', () => ({listCollectionEntries}));

// Linear names who a key is for, and Notion who signed in, beside the workspace its tokens name.
const linearMcp = await import('./linear/linear-mcp');
mock.module('./linear/linear-mcp', () => ({...linearMcp, getLinearAccount: mock(async () => Ok('alex@example.com · Acme'))}));
const notionMcp = await import('./notion/notion-mcp');
mock.module('./notion/notion-mcp', () => ({
	...notionMcp,
	getNotionAccount: mock(async ({workspaceName}: {workspaceName: string | null}) => Ok(workspaceName ? `alex@example.com · ${workspaceName}` : 'alex@example.com')),
}));

// Notion's token endpoint: refreshes the tokens and names the workspace with them, but not for a
// sign-in it revoked.
const tokenRequests: string[] = [];
spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
	const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
	tokenRequests.push(String(input));
	if (body.get('refresh_token') === 'revoked') {
		return Response.json({error: 'invalid_grant'}, {status: 400});
	}
	return Response.json({access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600, token_type: 'bearer', workspace_name: 'Acme'});
}) as typeof fetch);

mock.module('../observability/log', () => ({
	log: {debug: mock(), info: mock(), warn: mock(), error: mock()},
	serializeError: mock(() => ({})),
}));

mock.module('../utils/env', () => ({env: {NODE_ENV: 'production', APP_URL: 'https://app.example.com'}}));

// Readable stand-ins for encryption, so a test can see what was stored.
mock.module('../utils/secret-crypto', () => ({
	encryptSecret: (plaintext: string): Result<string, ApiError> => Ok(`enc:${plaintext}`),
	decryptSecret: (stored: string): Result<string, ApiError> => Ok(stored.replace(/^enc:/, '')),
}));

const {movedCredential, movedPermissions, movedRun, takeOverCustomConnections} = await import('./take-over-custom');
const {EXA_MCP} = await import('./exa/route');
const {LINEAR_MCP} = await import('./linear/route');
const {PARALLEL_MCP} = await import('./parallel/route');

const LINEAR_ACTIONS = ['read', 'create', 'edit'];

function stored(credential: object): string {
	return `enc:${JSON.stringify(credential)}`;
}

const EXA_SIGN_IN = {
	auth: 'oauth',
	url: 'https://mcp.exa.ai/mcp',
	server: {
		name: 'mcp.exa.ai',
		url: 'https://mcp.exa.ai/mcp',
		registerUrl: 'https://auth.exa.ai/api/oauth/register',
		authorizeUrl: 'https://auth.exa.ai/oauth/authorize',
		tokenUrl: 'https://auth.exa.ai/api/oauth/token',
		scope: 'mcp:tools',
		handshake: true,
	},
	clientId: 'client-1',
	accessToken: 'access-1',
	refreshToken: 'refresh-1',
	expiresAt: null,
};

describe('movedPermissions', () => {
	test('an action is on where every tool of it the server listed was, by default and for each agent', () => {
		const moved = movedPermissions(LINEAR_MCP, LINEAR_ACTIONS, {
			listed: ['list_issues', 'get_issue', 'save_issue', 'create_comment'],
			defaults: ['list_issues', 'get_issue'],
			grants: [
				{agentId: 'agent-a', actionId: 'save_issue', allowed: true},
				{agentId: 'agent-b', actionId: 'get_issue', allowed: false},
				{agentId: 'agent-c', actionId: 'create_comment', allowed: true},
			],
		});

		expect(moved.defaults).toEqual(['read']);
		expect(moved.grants).toEqual([
			{agentId: 'agent-a', actionId: 'create', allowed: true},
			{agentId: 'agent-a', actionId: 'edit', allowed: true},
			{agentId: 'agent-b', actionId: 'read', allowed: false},
		]);
	});

	test('never allows more than before: an action with one of its tools off is off', () => {
		const moved = movedPermissions(LINEAR_MCP, LINEAR_ACTIONS, {
			listed: ['list_issues', 'get_issue'],
			defaults: ['list_issues'],
			grants: [{agentId: 'agent-a', actionId: 'list_issues', allowed: false}],
		});

		expect(moved).toEqual({defaults: [], grants: []});
	});

	test('a tool the server never listed counts for nothing', () => {
		const moved = movedPermissions(EXA_MCP, ['search', 'fetch'], {listed: ['web_search_exa', 'web_fetch_exa'], defaults: ['web_search_exa', 'web_fetch_exa'], grants: []});

		expect(moved.defaults).toEqual(['search', 'fetch']);
	});
});

describe('movedRun', () => {
	test("becomes the integration's request, titled from the params kept", () => {
		expect(movedRun(EXA_MCP, {id: 'e-1', action: 'web_search_exa', query: JSON.stringify({query: 'bun mocks', objective: 'bun mocks'})})).toEqual({
			id: 'e-1',
			collectionId: 'searches',
			action: 'run',
			recordTitle: 'bun mocks',
			query: null,
		});
		expect(movedRun(PARALLEL_MCP, {id: 'e-2', action: 'web_fetch', query: JSON.stringify({urls: ['https://example.com', 'https://example.org']})})).toMatchObject({
			collectionId: 'pages',
			action: 'read',
			recordTitle: 'https://example.com',
		});
		expect(movedRun(LINEAR_MCP, {id: 'e-3', action: 'list_issues', query: JSON.stringify({query: 'login'})})).toMatchObject({
			collectionId: 'issues',
			action: 'list',
			recordTitle: null,
			query: 'login',
		});
	});

	test('one tool can become different requests by its params, as saving a Linear issue creates or edits', () => {
		expect(movedRun(LINEAR_MCP, {id: 'e-1', action: 'save_issue', query: JSON.stringify({id: 'ENG-1', title: 'Fix it'})})).toMatchObject({action: 'update', recordTitle: 'ENG-1'});
		expect(movedRun(LINEAR_MCP, {id: 'e-2', action: 'save_issue', query: JSON.stringify({team: 'ENG', title: 'Fix it'})})).toMatchObject({action: 'create', recordTitle: 'Fix it'});
	});

	test('params cut short, or none, leave it without a title; a tool the integration has nothing for stays a tool run', () => {
		expect(movedRun(EXA_MCP, {id: 'e-1', action: 'web_search_exa', query: '{"query":"a very long que…'})).toMatchObject({collectionId: 'searches', recordTitle: null});
		expect(movedRun(EXA_MCP, {id: 'e-2', action: 'web_search_exa', query: null})).toMatchObject({collectionId: 'searches', recordTitle: null});
		expect(movedRun(EXA_MCP, {id: 'e-3', action: 'agent_run', query: null})).toBeNull();
	});
});

describe('movedCredential', () => {
	test("keeps a sign-in to the integration's own server, whatever the query of the address", () => {
		expect(movedCredential(EXA_MCP, stored({...EXA_SIGN_IN, url: 'https://mcp.exa.ai/mcp?tools=web_search_exa'})).unwrap()).toEqual({
			kind: 'moved',
			credential: {clientId: 'client-1', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null},
		});
	});

	test("a token typed in becomes the integration's API key, where it takes one and the token is a bare one", () => {
		expect(movedCredential(EXA_MCP, stored({auth: 'token', url: 'https://mcp.exa.ai/mcp', token: 'key-1'})).unwrap()).toEqual({kind: 'moved', credential: {auth: 'key', key: 'key-1'}});
		expect(movedCredential(PARALLEL_MCP, stored({auth: 'token', url: 'https://search.parallel.ai/mcp', token: 'pk_1'})).unwrap()).toEqual({kind: 'moved', credential: {auth: 'key', key: 'pk_1'}});
		expect(movedCredential(LINEAR_MCP, stored({auth: 'token', url: 'https://mcp.linear.app/mcp', token: 'lin_api_1'})).unwrap()).toEqual({kind: 'moved', credential: {auth: 'key', key: 'lin_api_1'}});
		expect(movedCredential(EXA_MCP, stored({auth: 'token', url: 'https://mcp.exa.ai/mcp', token: 'Basic abc'})).unwrap()).toEqual({kind: 'moved', credential: null});
	});

	test("a key in the address, as Exa's own setup writes it, becomes the integration's API key", () => {
		expect(movedCredential(EXA_MCP, stored({auth: 'none', url: 'https://mcp.exa.ai/mcp?exaApiKey=key-2'})).unwrap()).toEqual({kind: 'moved', credential: {auth: 'key', key: 'key-2'}});
	});

	test('a server reached with nothing at all stays custom, rather than stop working', () => {
		expect(movedCredential(PARALLEL_MCP, stored({auth: 'none', url: 'https://search.parallel.ai/mcp'})).unwrap()).toEqual({kind: 'stays'});
		expect(movedCredential(EXA_MCP, stored({auth: 'none', url: 'https://mcp.exa.ai/mcp'})).unwrap()).toEqual({kind: 'stays'});
	});

	test('a sign-in through another authorization server has to be signed in to again', () => {
		expect(movedCredential(EXA_MCP, stored({...EXA_SIGN_IN, server: {...EXA_SIGN_IN.server, tokenUrl: 'https://elsewhere.example.com/token'}})).unwrap()).toEqual({kind: 'moved', credential: null});
		expect(movedCredential(LINEAR_MCP, stored({...EXA_SIGN_IN, url: 'https://mcp.linear.app/sse'})).unwrap()).toEqual({kind: 'moved', credential: null});
	});

	test("a credential that can't be read is an error, never taken for none", () => {
		expect(movedCredential(LINEAR_MCP, 'enc:not json').isErr()).toBe(true);
	});
});

function customRow(id: string, account: string, credential: object, tools: string[], defaults: string[]) {
	return {
		id,
		account,
		credential: stored(credential),
		tools: JSON.stringify(tools.map((name) => ({name, inputSchema: {type: 'object'}}))),
		defaults: defaults.map((actionId) => ({actionId})),
		agentGrants: [],
	};
}

// What each connection moved became, as `takeOverConnection` was told with it locked.
let moves: Array<{connectionId: string} & Record<string, string | null | object>> = [];

beforeEach(() => {
	mock.clearAllMocks();
	moves = [];
	tokenRequests.length = 0;
	listCollectionEntries.mockResolvedValue(Ok([]));
	takeOverConnection.mockImplementation(async (connectionId: string, move: () => Promise<Result<object, ApiError>>) => {
		const moved = await move();
		if (moved.isErr()) {
			return moved;
		}
		moves.push({connectionId, ...moved.value});
		return Ok(true);
	});
});

describe('takeOverCustomConnections', () => {
	test('moves each custom connection to a server an integration takes over, and leaves the rest', async () => {
		listCustomMcpConnections.mockResolvedValue(
			Ok([
				customRow('mcp-exa', 'mcp.exa.ai/mcp', EXA_SIGN_IN, ['web_search_exa', 'web_fetch_exa', 'agent_run'], ['web_search_exa', 'agent_run']),
				customRow('mcp-parallel', 'search.parallel.ai/mcp', {auth: 'token', url: 'https://search.parallel.ai/mcp', token: 'pk_5678'}, ['web_search', 'web_fetch'], ['web_search', 'web_fetch']),
				customRow('mcp-keyless', 'search.parallel.ai/mcp', {auth: 'none', url: 'https://search.parallel.ai/mcp'}, ['web_search'], ['web_search']),
				customRow('mcp-docs', 'mcp.example.com/mcp', {auth: 'none', url: 'https://mcp.example.com/mcp'}, ['web_search'], ['web_search']),
			]),
		);
		listCollectionEntries.mockImplementation(async (connectionId: string) =>
			Ok(
				connectionId === 'mcp-exa'
					? [
							{id: 'e-1', action: 'web_search_exa', query: JSON.stringify({query: 'bun mocks'})},
							{id: 'e-2', action: 'agent_run', query: null},
						]
					: [],
			),
		);

		await takeOverCustomConnections();

		expect(listCollectionEntries).toHaveBeenCalledWith('mcp-exa', 'tools');
		expect(takeOverConnection.mock.calls.map((call) => call[0])).toEqual(['mcp-exa', 'mcp-parallel']);
		expect(moves).toEqual([
			{
				connectionId: 'mcp-exa',
				integrationId: 'exa',
				account: 'Signed in',
				credential: stored({clientId: 'client-1', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null}),
				defaults: ['search'],
				grants: [],
				runs: [{id: 'e-1', collectionId: 'searches', action: 'run', recordTitle: 'bun mocks', query: null}],
			},
			{
				connectionId: 'mcp-parallel',
				integrationId: 'parallel',
				account: 'API key ending 5678',
				credential: stored({auth: 'key', key: 'pk_5678'}),
				defaults: ['search', 'fetch'],
				grants: [],
				runs: [],
			},
		]);
		// Exa says nothing of who signed in, so its tokens aren't refreshed to ask.
		expect(tokenRequests).toEqual([]);
	});

	test('a sign-in is refreshed first, for the account as signing in again would name it, workspace and all', async () => {
		const notionSignIn = {...EXA_SIGN_IN, url: 'https://mcp.notion.com/mcp', server: {...EXA_SIGN_IN.server, url: 'https://mcp.notion.com/mcp', tokenUrl: 'https://mcp.notion.com/token'}};
		listCustomMcpConnections.mockResolvedValue(
			Ok([
				customRow('mcp-notion', 'mcp.notion.com/mcp', notionSignIn, ['notion-search'], ['notion-search']),
				customRow('mcp-revoked', 'mcp.notion.com/mcp', {...notionSignIn, refreshToken: 'revoked'}, ['notion-search'], ['notion-search']),
			]),
		);

		await takeOverCustomConnections();

		expect(tokenRequests).toEqual(['https://mcp.notion.com/token', 'https://mcp.notion.com/token']);
		expect(moves[0]).toMatchObject({connectionId: 'mcp-notion', integrationId: 'notion', account: 'alex@example.com · Acme', defaults: ['read']});
		expect(JSON.parse(String(moves[0]?.credential).replace(/^enc:/, ''))).toMatchObject({clientId: 'client-1', accessToken: 'access-2', refreshToken: 'refresh-2'});
		// A sign-in Notion revoked carries nothing over: it waits to be signed in to.
		expect(moves[1]).toMatchObject({connectionId: 'mcp-revoked', integrationId: 'notion', account: 'mcp.notion.com/mcp', credential: null});
	});

	test("a credential that can't be read is left as it is, for the next start", async () => {
		listCustomMcpConnections.mockResolvedValue(Ok([{...customRow('mcp-linear', 'mcp.linear.app/mcp', {}, ['list_issues'], []), credential: 'enc:not json'}]));

		await takeOverCustomConnections();

		expect(takeOverConnection).not.toHaveBeenCalled();
	});

	test('a connection another server moved first is left to it, and the rest still move', async () => {
		listCustomMcpConnections.mockResolvedValue(
			Ok([
				customRow('mcp-exa', 'mcp.exa.ai/mcp', EXA_SIGN_IN, ['web_search_exa'], []),
				customRow('mcp-linear', 'mcp.linear.app/mcp', {auth: 'token', url: 'https://mcp.linear.app/mcp', token: 'lin_api_1'}, ['list_issues', 'get_issue'], ['list_issues', 'get_issue']),
			]),
		);
		takeOverConnection.mockImplementationOnce(async () => Ok(false));

		await takeOverCustomConnections();

		expect(takeOverConnection).toHaveBeenCalledTimes(2);
		expect(moves).toHaveLength(1);
		expect(moves[0]).toMatchObject({
			connectionId: 'mcp-linear',
			integrationId: 'linear',
			account: 'alex@example.com · Acme',
			credential: stored({auth: 'key', key: 'lin_api_1'}),
			defaults: ['read'],
		});
	});
});
