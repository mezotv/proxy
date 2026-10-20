import {Result} from 'ts-results-es';
import {z} from 'zod';

import {ApiErr, type ApiError, Do, parseSchema} from '@proxy/utils';

import {callMcpTool} from '../mcp/mcp-client';
import type {McpServer} from '../mcp/mcp-oauth';

/**
 * Notra's MCP server and what its tools answer: JSON, as Notra's API does. A sign-in, or an API
 * key, is for one workspace. The server keeps a session between calls, and checks an API key only
 * when a tool is called, answering a bad one with the tool failing: "Invalid API key". A tool that
 * fails otherwise says why in words: "Post not found: …", or what the API turned down.
 */

const AUTH_BASE = 'https://oauth.usenotra.com/oauth2';

// The API out of reach behind the server, rather than the call turned down.
const UNREACHABLE = /^HTTP 5\d\d|timed out|was cancelled|fetch failed/i;

function notraToolError(text: string): ApiError | null {
	const message = text.trim();
	if (/invalid api key|unauthorized/i.test(message)) {
		return ApiErr.credentialsRejected();
	}
	if (/not found/i.test(message)) {
		return ApiErr.notFound('post');
	}
	if (UNREACHABLE.test(message)) {
		return null;
	}
	return ApiErr.validationError(`Notra turned it down: ${message || 'it didn’t say why'}`);
}

export const NOTRA: McpServer = {
	name: 'Notra',
	url: 'https://mcp.usenotra.com/mcp',
	registerUrl: `${AUTH_BASE}/register`,
	authorizeUrl: `${AUTH_BASE}/authorize`,
	tokenUrl: `${AUTH_BASE}/token`,
	scope: 'openid offline_access',
	handshake: true,
	toolError: notraToolError,
};

export function parseJson<T>(text: string, schema: z.ZodType<T>): Result<T, ApiError> {
	return Result.wrap((): unknown => JSON.parse(text))
		.mapErr((cause) => ApiErr.providerUnreachable(cause))
		.andThen((json) => parseSchema(schema, json).mapErr((error) => ApiErr.providerUnreachable(error)));
}

const whoAmISchema = z.object({workspace: z.object({name: z.string(), slug: z.string()})});

/**
 * The Notra workspace a sign-in or a key is for, by its name and slug, as `whoami` names them:
 * "Acme · acme". A key for a workspace renews its connection, as signing in to it again does.
 */
export function getNotraAccount(accessToken: string): Promise<Result<string, ApiError>> {
	return Do(async ($) => {
		const {workspace} = $(parseJson($(await callMcpTool(NOTRA, accessToken, 'whoami', {})), whoAmISchema));
		return `${workspace.name} · ${workspace.slug}`;
	});
}

export type NotraPost = {
	id: string;
	title: string;
	contentType: string;
	status: string;
	slug: string;
	updatedAt: string;
	markdown: string;
};

const postSchema = z.object({
	id: z.string().min(1),
	title: z.string(),
	contentType: z.string(),
	status: z.string(),
	slug: z.string().nullish(),
	updatedAt: z.string(),
	// A full post's; a list's posts have an excerpt instead.
	markdown: z.string().nullish(),
});

function toPost(post: z.infer<typeof postSchema>): NotraPost {
	return {...post, title: post.title || 'Untitled post', slug: post.slug ?? '', markdown: post.markdown ?? ''};
}

const postsSchema = z.object({posts: z.array(postSchema), pagination: z.object({nextPage: z.number().nullable()})});

/** A `list_posts` answer's posts, and the number of the next page, if there is one. */
export function parseNotraPosts(text: string): Result<{posts: NotraPost[]; nextPage: number | null}, ApiError> {
	return parseJson(text, postsSchema).map((page) => ({posts: page.posts.map(toPost), nextPage: page.pagination.nextPage}));
}

/** A `get_post`, `create_post` or `update_post` answer's post. */
export function parseNotraPost(text: string): Result<NotraPost, ApiError> {
	return parseJson(text, z.object({post: postSchema})).map(({post}) => toPost(post));
}
