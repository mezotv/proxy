import {Err, Ok, type Result} from 'ts-results-es';

import {ApiErr, type ApiError, Do} from '@proxy/utils';
import {NOTRA_CONTENT_TYPES, NOTRA_CREATABLE_TYPES} from '@proxy/integrations';

import {callMcpToolFor} from '../connections/mcp/mcp-session';
import {NOTRA, parseNotraPost, parseNotraPosts, type NotraPost} from '../connections/notra/notra-mcp';
import type {Connector, DataRecord, ListQuery, RecordPage, RecordTarget, RecordValues} from './connector';

/**
 * A Notra workspace's posts, fetched live from Notra's MCP server, by Notra's own ids. A list is the
 * newest posts first, 50 to a page, narrowed to a type of post; Notra can't search them. A post is
 * made as a draft, and published or taken back to a draft only by the Publish and Unpublish
 * commands. An edit sends only the fields written differently; a post's type is set when it is
 * made, and its content can't be emptied.
 */

const PAGE_SIZE = 50;

function callNotra(target: RecordTarget, name: string, args: Record<string, unknown>): Promise<Result<string, ApiError>> {
	return callMcpToolFor(NOTRA, target.connection, name, args);
}

// Notra's name for a type of post from how it is written, "Blog post"; null for one it doesn't have.
function contentTypeOf(written: string): string | null {
	const entry = Object.entries(NOTRA_CONTENT_TYPES).find(([, label]) => label === written.trim());
	return entry ? entry[0] : null;
}

function summaryValues(post: NotraPost): RecordValues {
	return {
		title: post.title,
		type: NOTRA_CONTENT_TYPES[post.contentType] ?? post.contentType,
		status: post.status === 'published' ? 'Published' : 'Draft',
		updated: post.updatedAt,
	};
}

function toRecord(post: NotraPost, values: RecordValues): DataRecord {
	return {id: post.id, values, updatedAt: post.updatedAt};
}

function fullRecord(post: NotraPost): DataRecord {
	return toRecord(post, {...summaryValues(post), slug: post.slug, content: post.markdown});
}

function notFoundAs(recordId: string) {
	return (error: ApiError): ApiError => (error.kind === 'not_found' ? ApiErr.notFound('record', recordId) : error);
}

function fetchPost(target: RecordTarget, recordId: string): Promise<Result<NotraPost, ApiError>> {
	return Do(async ($) => $(parseNotraPost($((await callNotra(target, 'get_post', {postId: recordId})).mapErr(notFoundAs(recordId))))));
}

function list(target: RecordTarget, query: ListQuery): Promise<Result<RecordPage, ApiError>> {
	return Do(async ($) => {
		const page = query.page === null ? 1 : Number(query.page);
		if (!Number.isInteger(page) || page < 1) {
			return $(Err(ApiErr.validationError('Not a page of Notra posts')));
		}
		const contentType = query.filter ? contentTypeOf(query.filter) : null;
		if (query.filter && !contentType) {
			return $(Err(ApiErr.validationError(`Notra has no ${query.filter} posts`)));
		}
		const text = $(await callNotra(target, 'list_posts', {sort: 'desc', limit: PAGE_SIZE, page, ...(contentType ? {contentType: [contentType]} : {})}));
		const posts = $(parseNotraPosts(text));
		return {records: posts.posts.map((post) => toRecord(post, summaryValues(post))), nextPage: posts.nextPage === null ? null : String(posts.nextPage)};
	});
}

// What `update_post` takes for one field written differently.
function fieldArg(key: string, value: string): Result<Record<string, unknown>, ApiError> {
	const trimmed = value.trim();
	if (key === 'title') {
		return trimmed === '' ? Err(ApiErr.validationError('A post needs a title')) : Ok({title: trimmed});
	}
	if (key === 'slug') {
		return Ok({slug: trimmed === '' ? null : trimmed});
	}
	if (key === 'content') {
		return trimmed === '' ? Err(ApiErr.validationError('A post’s content can’t be emptied')) : Ok({markdown: value});
	}
	if (key === 'type') {
		return Err(ApiErr.validationError('A post’s type can’t be changed'));
	}
	return Err(ApiErr.validationError(`${key} can't be set`));
}

function updateArgs(fields: RecordValues): Result<Record<string, unknown>, ApiError> {
	const args: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		const arg = fieldArg(key, value);
		if (arg.isErr()) {
			return arg;
		}
		Object.assign(args, arg.value);
	}
	return Ok(args);
}

function setStatus(status: 'draft' | 'published') {
	return (target: RecordTarget, recordId: string): Promise<Result<DataRecord, ApiError>> =>
		Do(async ($) => fullRecord($(parseNotraPost($((await callNotra(target, 'update_post', {postId: recordId, status})).mapErr(notFoundAs(recordId)))))));
}

export const notraConnector: Connector = {
	list,
	get: (target, recordId) => Do(async ($) => fullRecord($(await fetchPost(target, recordId)))),
	create: (target, values) =>
		Do(async ($) => {
			const title = (values.title ?? '').trim();
			if (!title) {
				return $(Err(ApiErr.validationError('A post needs a title')));
			}
			const type = (values.type ?? '').trim();
			const contentType = NOTRA_CREATABLE_TYPES.includes(type) ? contentTypeOf(type) : null;
			if (!contentType) {
				return $(Err(ApiErr.validationError(`A post’s type is one of ${NOTRA_CREATABLE_TYPES.join(', ')}`)));
			}
			const slug = (values.slug ?? '').trim();
			const content = values.content ?? '';
			const args = {title, contentType, status: 'draft', ...(slug ? {slug} : {}), ...(content.trim() ? {markdown: content} : {})};
			return fullRecord($(parseNotraPost($(await callNotra(target, 'create_post', args)))));
		}),
	update: (target, recordId, values) =>
		Do(async ($) => {
			const post = $(await fetchPost(target, recordId));
			const current = fullRecord(post).values;
			const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => (key === 'content' ? value !== current.content : value.trim() !== (current[key] ?? ''))));
			if (Object.keys(changed).length === 0) {
				return fullRecord(post);
			}
			const args = $(updateArgs(changed));
			return fullRecord($(parseNotraPost($((await callNotra(target, 'update_post', {postId: post.id, ...args})).mapErr(notFoundAs(recordId))))));
		}),
	remove: (target, recordId) => Do(async ($) => void $((await callNotra(target, 'delete_post', {postId: recordId})).mapErr(notFoundAs(recordId)))),
	commands: {publish: setStatus('published'), unpublish: setStatus('draft')},
};
