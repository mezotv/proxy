import {textParam, type BuiltInMcp} from '../mcp/built-in';
import {getLinearAccount, LINEAR} from './linear-mcp';

/**
 * Linear, through its MCP server, as Granola and Notion are. A new Linear connection lets agents
 * read its issues by default; creating and editing are turned on on the connection's page. Its
 * `save_issue` both creates and edits, by whether it is given an issue.
 */
export const LINEAR_MCP: BuiltInMcp = {
	integrationId: 'linear',
	server: LINEAR,
	account: getLinearAccount,
	defaults: ['read'],
	tools: {
		list_issues: {actions: ['read'], run: (params) => ({collectionId: 'issues', operation: 'list', query: textParam(params, 'query')})},
		get_issue: {actions: ['read'], run: (params) => ({collectionId: 'issues', operation: 'view', title: textParam(params, 'id')})},
		save_issue: {
			actions: ['create', 'edit'],
			run: (params) => {
				const id = textParam(params, 'id');
				return id ? {collectionId: 'issues', operation: 'update', title: id} : {collectionId: 'issues', operation: 'create', title: textParam(params, 'title')};
			},
		},
	},
};
