import {builtInHosts, type BuiltInMcp} from './mcp/built-in';
import {EXA_MCP} from './exa/route';
import {GRANOLA_MCP} from './granola/route';
import {LINEAR_MCP} from './linear/route';
import {NOTION_MCP} from './notion/route';
import {PARALLEL_MCP} from './parallel/route';

/**
 * Every integration built on its provider's MCP server (`mcp/built-in.ts`). Adding one here is all
 * it takes for the custom MCP form to refuse its server, and for custom connections to it to be
 * moved over when the api starts.
 */
export const BUILT_IN_MCP: BuiltInMcp[] = [GRANOLA_MCP, NOTION_MCP, LINEAR_MCP, EXA_MCP, PARALLEL_MCP];

/** The integration that takes over a custom MCP server at this host, if one does. */
export function builtInForHost(host: string): BuiltInMcp | undefined {
	return BUILT_IN_MCP.find((builtIn) => builtInHosts(builtIn).includes(host.toLowerCase()));
}
