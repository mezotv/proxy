import type {BuiltInMcp} from '../mcp/built-in';
import {mcpConnectRoutes} from '../mcp/mcp-connect';
import {GRANOLA, getGranolaAccount} from './granola-mcp';

/**
 * Granola, through its MCP server. A new Granola connection lets agents read both its notes and
 * its transcripts by default; either can be turned off on the connection's page.
 */
export const GRANOLA_MCP: BuiltInMcp = {
	integrationId: 'granola',
	server: GRANOLA,
	account: (signIn) => getGranolaAccount(signIn.credential.accessToken),
	defaults: ['readNotes', 'readTranscripts'],
	tools: {
		list_meetings: {actions: ['readNotes'], run: () => ({collectionId: 'notes', operation: 'list'})},
		get_meetings: {actions: ['readNotes'], run: () => ({collectionId: 'notes', operation: 'view'})},
		get_meeting_transcript: {actions: ['readTranscripts'], run: () => ({collectionId: 'transcripts', operation: 'view'})},
	},
};

export const {handleStart: handleStartGranolaRoute, handleCallback: handleGranolaCallbackRoute} = mcpConnectRoutes(GRANOLA_MCP);
