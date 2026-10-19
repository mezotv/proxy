import {beforeEach, describe, expect, mock, spyOn, test} from 'bun:test';
import {Ok, type Result} from 'ts-results-es';

import type {ApiError} from '@proxy/utils';

const findAccountConnection = mock();
const createConnection = mock();
const renewConnection = mock();

mock.module('@proxy/db/connection', () => ({
	getConnection: mock(),
	findAccountConnection,
	createConnection,
	renewConnection,
	updateConnectionCredential: mock(),
	getConnectionCredential: mock(async () => Ok(null)),
	updateConnectionTools: mock(),
	updateConnectionName: mock(),
}));

const getUserOrgId = mock();

mock.module('@proxy/db/organization', () => ({getUserOrgId}));

mock.module('../../observability/log', () => ({
	log: {debug: mock(), info: mock(), warn: mock(), error: mock()},
	serializeError: mock(() => ({})),
}));

mock.module('../../utils/env', () => ({env: {NODE_ENV: 'production', APP_URL: 'https://app.example.com'}}));

// The servers are on the internet.
mock.module('node:dns/promises', () => ({default: {lookup: async () => [{address: '93.184.216.34', family: 4}]}}));

// Readable stand-ins for encryption, so a test can see what was stored.
mock.module('../../utils/secret-crypto', () => ({
	encryptSecret: (plaintext: string): Result<string, ApiError> => Ok(`enc:${plaintext}`),
	decryptSecret: (stored: string): Result<string, ApiError> => Ok(stored.replace(/^enc:/, '')),
}));

const CALLBACK = 'https://app.example.com/api/connections/parallel/callback';

// Parallel's authorization server: each request, and its answers.
const parallel = {requests: [] as Array<{url: URL; body: string}>};

spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
	parallel.requests.push({url, body: typeof init?.body === 'string' ? init.body : ''});
	if (url.pathname === '/getKeys/register') {
		return Response.json({client_id: 'client-1'}, {status: 201});
	}
	return Response.json({access_token: 'key-1', token_type: 'bearer'});
}) as typeof fetch);

// The sign-in routes the api makes of Parallel's declaration.
async function routes() {
	const {mcpConnectRoutes} = await import('../mcp/mcp-connect');
	const {PARALLEL_MCP} = await import('./route');
	return mcpConnectRoutes(PARALLEL_MCP);
}

function makeRes() {
	const cookies: Array<{name: string; value: string; options: Record<string, unknown>}> = [];
	const res = {
		cookies,
		redirect: mock(),
		cookie: mock((name: string, value: string, options: Record<string, unknown>) => {
			cookies.push({name, value, options});
		}),
		clearCookie: mock(),
		status: mock(() => res),
		json: mock(() => res),
	};
	return res;
}

const user = {userId: 'user-1', email: 'alex@example.com'};

async function start() {
	const {handleStart: handleStartParallelRoute} = await routes();
	const res = makeRes();
	await handleStartParallelRoute({user, query: {}, headers: {}} as never, res as never);
	const cookie = res.cookies.find((candidate) => candidate.name === 'proxy.parallel-state');
	const authorizeUrl = new URL(res.redirect.mock.calls[0]?.[0] as string);
	return {cookie, authorizeUrl, state: authorizeUrl.searchParams.get('state') ?? ''};
}

async function callback(args: {cookie: string; query: Record<string, string>}) {
	const {handleCallback: handleParallelCallbackRoute} = await routes();
	const res = makeRes();
	await handleParallelCallbackRoute({user, query: args.query, headers: {cookie: `proxy.parallel-state=${args.cookie}`}} as never, res as never);
	return res;
}

beforeEach(() => {
	mock.clearAllMocks();
	parallel.requests = [];
	getUserOrgId.mockResolvedValue(Ok('org-1'));
	findAccountConnection.mockResolvedValue(Ok(null));
	createConnection.mockResolvedValue(Ok({id: 'conn-1'}));
	renewConnection.mockResolvedValue(Ok(undefined));
});

describe('handleStartParallelRoute', () => {
	test("registers with Parallel's authorization server and sends the browser to its sign-in with PKCE", async () => {
		const {cookie, authorizeUrl} = await start();

		expect(parallel.requests[0]?.url.href).toBe('https://platform.parallel.ai/getKeys/register');
		expect(JSON.parse(parallel.requests[0]?.body ?? '{}')).toMatchObject({redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none'});
		expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://platform.parallel.ai/getKeys/authorize');
		expect(authorizeUrl.searchParams.get('client_id')).toBe('client-1');
		expect(authorizeUrl.searchParams.get('scope')).toBe('key:read');
		expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorizeUrl.searchParams.get('resource')).toBe('https://search-mcp.parallel.ai/mcp');
		expect(cookie?.options).toMatchObject({httpOnly: true, path: '/api/connections/parallel'});
	});
});

describe('handleParallelCallbackRoute', () => {
	test('makes the connection, agents searching the web and reading pages', async () => {
		const {cookie, state} = await start();
		const res = await callback({cookie: cookie?.value ?? '', query: {state, code: 'code-1'}});

		expect(parallel.requests.at(-1)?.url.href).toBe('https://platform.parallel.ai/getKeys/token');
		const created = createConnection.mock.calls[0]?.[0];
		expect(created).toMatchObject({orgId: 'org-1', integrationId: 'parallel', account: 'Parallel', defaults: ['search', 'fetch']});
		expect(JSON.parse(String(created.credential).replace(/^enc:/, ''))).toMatchObject({clientId: 'client-1', refreshToken: null, expiresAt: null});
		expect(res.redirect).toHaveBeenCalledWith('https://app.example.com/connections/conn-1?added');
	});

	test('signing in again, with any account, gives the connection the new tokens', async () => {
		findAccountConnection.mockResolvedValue(Ok({id: 'conn-0'}));
		const {cookie, state} = await start();
		const res = await callback({cookie: cookie?.value ?? '', query: {state, code: 'code-1'}});

		expect(createConnection).not.toHaveBeenCalled();
		expect(renewConnection.mock.calls[0]?.[0]).toMatchObject({connectionId: 'conn-0'});
		expect(res.redirect).toHaveBeenCalledWith('https://app.example.com/connections/conn-0');
	});

	test('a sign-in turned down at Parallel goes back to the catalog', async () => {
		const {cookie, state} = await start();
		const res = await callback({cookie: cookie?.value ?? '', query: {state, error: 'access_denied'}});

		expect(res.redirect).toHaveBeenCalledWith('https://app.example.com/connections/new?error=parallel');
		expect(createConnection).not.toHaveBeenCalled();
	});
});
