import {beforeEach, describe, expect, mock, test} from 'bun:test';
import {Ok, type Result} from 'ts-results-es';

import type {ApiError} from '@proxy/utils';

const listCustomMcpConnections = mock();
const takeOverConnection = mock();

mock.module('@proxy/db/connection', () => ({
	listCustomMcpConnections,
	takeOverConnection,
	findAccountConnection: mock(),
	getConnection: mock(),
	createConnection: mock(),
	renewConnection: mock(),
	updateConnectionCredential: mock(),
	getConnectionCredential: mock(async () => Ok(null)),
	updateConnectionTools: mock(),
	updateConnectionName: mock(),
}));

const listCollectionEntries = mock();

mock.module('@proxy/db/audit', () => ({listCollectionEntries}));

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
		expect(movedCredential(EXA_MCP, stored({...EXA_SIGN_IN, url: 'https://mcp.exa.ai/mcp?tools=web_search_exa'}))).toEqual({
			clientId: 'client-1',
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
			expiresAt: null,
		});
	});

	test('a token typed in, none, or a sign-in through another authorization server has to be signed in to again', () => {
		expect(movedCredential(EXA_MCP, stored({auth: 'token', url: 'https://mcp.exa.ai/mcp', token: 'key-1'}))).toBeNull();
		expect(movedCredential(PARALLEL_MCP, stored({auth: 'none', url: 'https://search.parallel.ai/mcp'}))).toBeNull();
		expect(movedCredential(EXA_MCP, stored({...EXA_SIGN_IN, server: {...EXA_SIGN_IN.server, tokenUrl: 'https://elsewhere.example.com/token'}}))).toBeNull();
		expect(movedCredential(LINEAR_MCP, stored({...EXA_SIGN_IN, url: 'https://mcp.linear.app/sse'}))).toBeNull();
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

beforeEach(() => {
	mock.clearAllMocks();
	listCollectionEntries.mockResolvedValue(Ok([]));
	takeOverConnection.mockResolvedValue(Ok(true));
});

describe('takeOverCustomConnections', () => {
	test('moves each custom connection to a server an integration takes over, and leaves the rest', async () => {
		listCustomMcpConnections.mockResolvedValue(
			Ok([
				customRow('mcp-exa', 'mcp.exa.ai/mcp', EXA_SIGN_IN, ['web_search_exa', 'web_fetch_exa', 'agent_run'], ['web_search_exa', 'agent_run']),
				customRow('mcp-parallel', 'search.parallel.ai/mcp', {auth: 'none', url: 'https://search.parallel.ai/mcp'}, ['web_search', 'web_fetch'], ['web_search', 'web_fetch']),
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
		expect(takeOverConnection.mock.calls.map((call) => call[0])).toEqual([
			{
				connectionId: 'mcp-exa',
				integrationId: 'exa',
				account: 'Exa',
				credential: stored({clientId: 'client-1', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null}),
				defaults: ['search'],
				grants: [],
				runs: [{id: 'e-1', collectionId: 'searches', action: 'run', recordTitle: 'bun mocks', query: null}],
			},
			{
				connectionId: 'mcp-parallel',
				integrationId: 'parallel',
				account: 'search.parallel.ai/mcp',
				credential: null,
				defaults: ['search', 'fetch'],
				grants: [],
				runs: [],
			},
		]);
	});

	test('a connection another server moved first is left to it, and the rest still move', async () => {
		listCustomMcpConnections.mockResolvedValue(
			Ok([
				customRow('mcp-exa', 'mcp.exa.ai/mcp', EXA_SIGN_IN, ['web_search_exa'], []),
				customRow('mcp-linear', 'mcp.linear.app/mcp', {auth: 'token', url: 'https://mcp.linear.app/mcp', token: 'lin_api_1'}, ['list_issues', 'get_issue'], ['list_issues', 'get_issue']),
			]),
		);
		takeOverConnection.mockResolvedValueOnce(Ok(false)).mockResolvedValueOnce(Ok(true));

		await takeOverCustomConnections();

		expect(takeOverConnection).toHaveBeenCalledTimes(2);
		expect(takeOverConnection.mock.calls[1]?.[0]).toMatchObject({connectionId: 'mcp-linear', integrationId: 'linear', credential: null, defaults: ['read']});
	});
});
