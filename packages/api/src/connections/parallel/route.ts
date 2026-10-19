import {Ok} from 'ts-results-es';

import {firstParam, textParam, type BuiltInMcp} from '../mcp/built-in';
import {PARALLEL} from './parallel-mcp';

/**
 * Parallel, through its MCP server, as Exa is, its keyless server the same service. Parallel says
 * nothing of who signed in, so the account is Parallel's name: an organization signing in from the
 * catalog again gives its one Parallel connection the new tokens. A new Parallel connection lets
 * agents search the web and read pages.
 */
export const PARALLEL_MCP: BuiltInMcp = {
	integrationId: 'parallel',
	server: PARALLEL,
	otherHosts: ['search.parallel.ai'],
	account: async () => Ok(PARALLEL.name),
	defaults: ['search', 'fetch'],
	tools: {
		web_search: {
			actions: ['search'],
			run: (params) => ({collectionId: 'searches', operation: 'run', title: textParam(params, 'objective') ?? firstParam(params, 'search_queries')}),
		},
		web_fetch: {actions: ['fetch'], run: (params) => ({collectionId: 'pages', operation: 'read', title: firstParam(params, 'urls')})},
	},
};
