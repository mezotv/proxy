import {afterEach, describe, expect, test} from 'bun:test';
import {clearAgentTask, isTaskRefusal, storeAgentTask, storedAgentTask} from '@/lib/agent-task';

afterEach(() => clearAgentTask());

describe('storedAgentTask', () => {
	test('is the task stored, and none for anything else there', () => {
		storeAgentTask({id: 'task-1', title: 'Triage inbox', goal: 'Archive the newsletters'});
		expect(storedAgentTask()).toEqual({
			id: 'task-1',
			title: 'Triage inbox',
			goal: 'Archive the newsletters',
		});

		localStorage.setItem('agent-task', '{"id":');
		expect(storedAgentTask()).toBeNull();
		localStorage.setItem('agent-task', '{"id":""}');
		expect(storedAgentTask()).toBeNull();
	});
});

describe('isTaskRefusal', () => {
	const refused = (status: number, body: unknown) => ({
		kind: 'http' as const,
		url: '/api/agent/connections/mail-1/tools/emails_list',
		status,
		body,
	});

	test('is a task that is unknown, finished or abandoned, and no other refusal', () => {
		expect(isTaskRefusal(refused(404, {error: 'not_found', resource: 'task'}))).toBe(true);
		expect(
			isTaskRefusal(
				refused(409, {error: 'conflict', message: 'Task task-1 (Triage inbox) is finished.'}),
			),
		).toBe(true);
		expect(isTaskRefusal(refused(404, {error: 'not_found', resource: 'connection'}))).toBe(false);
		expect(isTaskRefusal(refused(403, {error: 'forbidden'}))).toBe(false);
		expect(isTaskRefusal({kind: 'network', url: '/api', cause: null})).toBe(false);
	});
});
