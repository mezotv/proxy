import {textParam, type BuiltInMcp} from '../mcp/built-in';
import {getNotraAccount, NOTRA} from './notra-mcp';

/**
 * Notra, through its MCP server, as Linear is, signed in to or given one of its API keys, which its
 * server takes as a bearer token too. A new Notra connection lets agents read its posts by default;
 * creating, editing, publishing and deleting are turned on on the connection's page. Its
 * `update_post` both edits and publishes, by whether it is given a status.
 */
export const NOTRA_MCP: BuiltInMcp = {
	integrationId: 'notra',
	server: NOTRA,
	account: getNotraAccount,
	// Notra checks a key only when a tool is called, so asking who it is for is the check.
	apiKey: {check: async (key) => (await getNotraAccount(key)).map(() => undefined)},
	defaults: ['read'],
	tools: {
		list_posts: {actions: ['read'], run: () => ({collectionId: 'posts', operation: 'list'})},
		get_post: {actions: ['read'], run: (params) => ({collectionId: 'posts', operation: 'view', title: textParam(params, 'postId')})},
		create_post: {actions: ['create', 'publish'], run: (params) => ({collectionId: 'posts', operation: 'create', title: textParam(params, 'title')})},
		update_post: {
			actions: ['edit', 'publish'],
			run: (params) => {
				const status = textParam(params, 'status');
				const operation = status === null ? 'update' : status === 'published' ? 'publish' : 'unpublish';
				return {collectionId: 'posts', operation, title: textParam(params, 'postId')};
			},
		},
		delete_post: {actions: ['delete'], run: (params) => ({collectionId: 'posts', operation: 'delete', title: textParam(params, 'postId')})},
	},
};
