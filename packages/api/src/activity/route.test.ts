import {afterEach, beforeEach, describe, expect, mock, setSystemTime, test} from 'bun:test';
import {Ok} from 'ts-results-es';

const getUserOrgId = mock();
const listAuditEntries = mock();
const countAuditEntriesByDay = mock();
const countAuditEntriesByAction = mock();

mock.module('@proxy/db/organization', () => ({getUserOrgId}));
mock.module('@proxy/db/audit', () => ({listAuditEntries, countAuditEntriesByDay, countAuditEntriesByAction}));

const listAgentTasks = mock();

mock.module('@proxy/db/task', () => ({listAgentTasks}));

function makeRequest(query: Record<string, string>) {
	return {user: {userId: 'user-1', email: 'test@example.com', name: 'Test User'}, query};
}

beforeEach(() => {
	mock.clearAllMocks();
	getUserOrgId.mockResolvedValue(Ok('org-1'));
	listAuditEntries.mockResolvedValue(Ok([]));
	listAgentTasks.mockResolvedValue(Ok([]));
	countAuditEntriesByDay.mockResolvedValue(Ok([{day: '2026-10-16', agentId: null, count: 2, denied: 0}]));
	countAuditEntriesByAction.mockResolvedValue(Ok([{connectionId: 'c1', collectionId: 'events', action: 'create', outcome: 'allowed', count: 2}]));
	// Late on the 15th in UTC: already the 16th in Berlin.
	setSystemTime(new Date('2026-10-15T23:30:00Z'));
});

afterEach(() => {
	setSystemTime();
});

describe('handleActivitySummaryRoute', () => {
	test('counts a year of whole weeks and the past week, by days on the person’s clock', async () => {
		const {handleActivitySummaryRoute} = await import('./route');
		const result = await handleActivitySummaryRoute(makeRequest({timeZone: 'Europe/Berlin'}) as never);

		expect(result.unwrap()).toEqual({
			today: '2026-10-16',
			days: [{day: '2026-10-16', agentId: null, count: 2, denied: 0}],
			week: [{connectionId: 'c1', collectionId: 'events', action: 'create', outcome: 'allowed', count: 2}],
		});
		expect(countAuditEntriesByDay).toHaveBeenCalledWith('org-1', 'Europe/Berlin', '2025-10-11');
		expect(countAuditEntriesByAction).toHaveBeenCalledWith('org-1', 'Europe/Berlin', '2026-10-10');
	});

	test('refuses what isn’t a time zone before it reaches the database', async () => {
		const {handleActivitySummaryRoute} = await import('./route');
		const result = await handleActivitySummaryRoute(makeRequest({timeZone: "UTC'; --"}) as never);

		expect(result.unwrapErr().kind).toBe('parse_error');
		expect(countAuditEntriesByDay).not.toHaveBeenCalled();
	});
});

describe('handleListActivityRoute', () => {
	test('narrows to one outcome and a span of time', async () => {
		const {handleListActivityRoute} = await import('./route');
		await handleListActivityRoute(makeRequest({outcome: 'denied', from: '2026-10-14T00:00:00+02:00', to: '2026-10-15T00:00:00+02:00'}) as never);

		expect(listAuditEntries).toHaveBeenCalledWith('org-1', {outcome: 'denied', from: new Date('2026-10-13T22:00:00Z'), to: new Date('2026-10-14T22:00:00Z')}, 500);
	});

	test('what Personal Agent Proxy did itself is the entries without an agent', async () => {
		const {handleListActivityRoute} = await import('./route');
		await handleListActivityRoute(makeRequest({agentId: 'proxy'}) as never);

		expect(listAuditEntries).toHaveBeenCalledWith('org-1', {agentId: null}, 500);
	});

	test('names the tasks the entries were made for, and the one asked for even without entries', async () => {
		const entry = {
			id: 'e1',
			agentId: 'agent-1',
			connectionId: 'c1',
			collectionId: 'emails',
			action: 'list',
			recordTitle: null,
			query: null,
			outcome: 'allowed',
			via: 'mcp',
			taskId: 'task-1',
			createdAt: new Date('2026-10-15T10:00:00Z'),
		};
		listAuditEntries.mockResolvedValue(Ok([entry, {...entry, id: 'e2', taskId: null, agentId: null}]));
		listAgentTasks.mockResolvedValue(
			Ok([{id: 'task-1', agentId: 'agent-1', title: 'Triage inbox', goal: 'Archive the newsletters', via: 'mcp', createdAt: new Date('2026-10-15T09:00:00Z'), finishedAt: null}]),
		);
		const {handleListActivityRoute} = await import('./route');
		const result = await handleListActivityRoute(makeRequest({taskId: 'task-2'}) as never);

		expect(listAuditEntries).toHaveBeenCalledWith('org-1', {taskId: 'task-2'}, 500);
		expect(listAgentTasks).toHaveBeenCalledWith('org-1', ['task-1', 'task-2']);
		expect(result.unwrap()).toEqual({
			entries: [
				{
					id: 'e1',
					agentId: 'agent-1',
					connectionId: 'c1',
					collectionId: 'emails',
					action: 'list',
					recordTitle: null,
					query: null,
					outcome: 'allowed',
					via: 'mcp',
					taskId: 'task-1',
					at: '2026-10-15T10:00:00.000Z',
				},
				{
					id: 'e2',
					agentId: null,
					connectionId: 'c1',
					collectionId: 'emails',
					action: 'list',
					recordTitle: null,
					query: null,
					outcome: 'allowed',
					via: 'mcp',
					taskId: null,
					at: '2026-10-15T10:00:00.000Z',
				},
			],
			tasks: [{id: 'task-1', agentId: 'agent-1', title: 'Triage inbox', goal: 'Archive the newsletters', via: 'mcp', startedAt: '2026-10-15T09:00:00.000Z', finishedAt: null}],
		});
	});
});
