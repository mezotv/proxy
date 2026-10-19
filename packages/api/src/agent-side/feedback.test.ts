import {beforeEach, describe, expect, mock, test} from 'bun:test';
import {Err, Ok} from 'ts-results-es';

import {ApiErr} from '@proxy/utils';

const saveAgentFeedback = mock();

mock.module('@proxy/db/feedback', () => ({saveAgentFeedback}));

const requireTask = mock();

mock.module('./tasks', () => ({requireTask, requireOpenTask: mock(), startAgentTask: mock(), finishAgentTask: mock(), listAgentOpenTasks: mock()}));

const agent = {agentId: 'agent-1', orgId: 'org-1', providerId: 'claude', name: 'Claude', experiments: []};

beforeEach(() => {
	mock.clearAllMocks();
	saveAgentFeedback.mockResolvedValue(Ok(undefined));
	requireTask.mockResolvedValue(Ok({id: 'task-1'}));
});

describe('sendAgentFeedback', () => {
	test('keeps the message, trimmed, with the agent and what it is about', async () => {
		const {sendAgentFeedback} = await import('./feedback');
		const result = await sendAgentFeedback({agent, via: 'mcp'}, {message: '  emails_list ignored the folder \n', connection: 'mail-1', tool: 'emails_list'});

		expect(result.unwrap()).toEqual({sent: true});
		expect(saveAgentFeedback).toHaveBeenCalledWith({
			orgId: 'org-1',
			agentId: 'agent-1',
			providerId: 'claude',
			message: 'emails_list ignored the folder',
			connectionId: 'mail-1',
			tool: 'emails_list',
			via: 'mcp',
			taskId: null,
		});
		expect(requireTask).not.toHaveBeenCalled();
	});

	test('without a connection or a tool, keeps none', async () => {
		const {sendAgentFeedback} = await import('./feedback');
		await sendAgentFeedback({agent, via: 'web'}, {message: 'The pages are slow', connection: ''});

		expect(saveAgentFeedback).toHaveBeenCalledWith(expect.objectContaining({connectionId: null, tool: null, via: 'web'}));
	});

	test('keeps the task it names once it is the agent’s, finished or not', async () => {
		const {sendAgentFeedback} = await import('./feedback');
		await sendAgentFeedback({agent, via: 'mcp'}, {message: 'read answered twice', task: 'task-1'});
		requireTask.mockResolvedValue(Err(ApiErr.notFound('task', 'task-9')));
		const unknown = await sendAgentFeedback({agent, via: 'mcp'}, {message: 'read answered twice', task: 'task-9'});

		expect(requireTask).toHaveBeenCalledWith(agent, 'task-1');
		expect(saveAgentFeedback).toHaveBeenCalledWith(expect.objectContaining({taskId: 'task-1'}));
		expect(unknown.unwrapErr()).toMatchObject({kind: 'not_found', resource: 'task'});
		expect(saveAgentFeedback).toHaveBeenCalledTimes(1);
	});

	test('an empty or overlong message is refused in words the agent can act on', async () => {
		const {sendAgentFeedback} = await import('./feedback');
		const empty = await sendAgentFeedback({agent, via: 'mcp'}, {message: '   '});
		const long = await sendAgentFeedback({agent, via: 'mcp'}, {message: 'x'.repeat(5001)});
		const missing = await sendAgentFeedback({agent, via: 'mcp'}, {});

		expect(empty.unwrapErr()).toMatchObject({kind: 'validation_error', message: expect.stringContaining('empty')});
		expect(long.unwrapErr()).toMatchObject({kind: 'validation_error', message: expect.stringContaining('under 5000')});
		expect(missing.unwrapErr().kind).toBe('parse_error');
		expect(saveAgentFeedback).not.toHaveBeenCalled();
	});
});
