import {Ok} from 'ts-results-es';

import {firstParam, textParam, type BuiltInMcp} from '../mcp/built-in';
import {EXA} from './exa-mcp';

/**
 * Exa, through its MCP server, as Granola, Notion and Linear are. Exa says nothing of who signed
 * in, so the account is Exa's name: an organization signing in from the catalog again gives its
 * one Exa connection the new tokens. A new Exa connection lets agents search the web and read pages.
 */
export const EXA_MCP: BuiltInMcp = {
	integrationId: 'exa',
	server: EXA,
	account: async () => Ok(EXA.name),
	defaults: ['search', 'fetch'],
	tools: {
		web_search_exa: {actions: ['search'], run: (params) => ({collectionId: 'searches', operation: 'run', title: textParam(params, 'query')})},
		web_search_advanced_exa: {actions: ['search'], run: (params) => ({collectionId: 'searches', operation: 'run', title: textParam(params, 'query')})},
		web_fetch_exa: {actions: ['fetch'], run: (params) => ({collectionId: 'pages', operation: 'read', title: firstParam(params, 'urls')})},
	},
};
