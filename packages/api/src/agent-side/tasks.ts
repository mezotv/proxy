import {Err, type Result} from 'ts-results-es';
import {z} from 'zod';

import {ApiErr, type ApiError, Do, parseSchema, requirePresent} from '@proxy/utils';
import type {SignedInAgent} from '@proxy/db/agent';
import {type AgentTaskRow, createAgentTask, finishAgentTask as markAgentTaskFinished, getAgentTask, listOpenAgentTasks} from '@proxy/db/task';

import type {AgentCaller} from './tools';

/**
 * Tasks: what an agent set out to do with Personal Agent Proxy. Before anything else, an agent
 * starts one, naming it and saying what the person asked for; it gives the task's id with every
 * call it makes, which the activity log keeps with the request; and it finishes the task when it is
 * done. So the person can see which request was made for what. An agent can have any number of
 * tasks under way at once, each with calls of its own.
 */

const MAX_TITLE = 120;
const MAX_GOAL = 2000;

const startSchema = z.object({title: z.string(), goal: z.string()});
const finishSchema = z.object({task: z.string()});

/** A task as an agent sees it: `task` is its id, which every other call takes. */
export type AgentTaskResponse = {task: string; title: string; goal: string; startedAt: string; finishedAt: string | null};

function toResponse(task: AgentTaskRow): AgentTaskResponse {
	return {task: task.id, title: task.title, goal: task.goal, startedAt: task.createdAt.toISOString(), finishedAt: task.finishedAt?.toISOString() ?? null};
}

/** Starts a task for the agent: `{title, goal}`, both trimmed and neither empty. */
export function startAgentTask(caller: AgentCaller, args: unknown): Promise<Result<AgentTaskResponse, ApiError>> {
	return Do(async ($) => {
		const parsed = $(parseSchema(startSchema, args));
		const title = parsed.title.trim();
		const goal = parsed.goal.trim();
		if (title === '') {
			return $(Err(ApiErr.validationError('The task needs a title: what it is, in a few words.')));
		}
		if (title.length > MAX_TITLE) {
			return $(Err(ApiErr.validationError(`The title is ${title.length} characters long; keep it under ${MAX_TITLE}, a few words.`)));
		}
		if (goal === '') {
			return $(Err(ApiErr.validationError('The task needs a goal: what the person asked for, in a sentence or two.')));
		}
		if (goal.length > MAX_GOAL) {
			return $(Err(ApiErr.validationError(`The goal is ${goal.length} characters long; keep it under ${MAX_GOAL}, a sentence or two.`)));
		}
		const task = $(await createAgentTask({orgId: caller.agent.orgId, agentId: caller.agent.agentId, title, goal, via: caller.via}));
		return toResponse(task);
	});
}

/** The agent's tasks still under way, newest first. */
export function listAgentOpenTasks(agent: SignedInAgent): Promise<Result<{tasks: AgentTaskResponse[]}, ApiError>> {
	return Do(async ($) => ({tasks: $(await listOpenAgentTasks(agent.orgId, agent.agentId)).map(toResponse)}));
}

/** Marks the agent's task `{task}` finished; one finished already stays as it is. */
export function finishAgentTask(caller: AgentCaller, args: unknown): Promise<Result<AgentTaskResponse, ApiError>> {
	return Do(async ($) => {
		const {task: taskId} = $(parseSchema(finishSchema, args));
		const task = $(await markAgentTaskFinished(caller.agent.orgId, caller.agent.agentId, taskId));
		return toResponse($(requirePresent(task, ApiErr.notFound('task', taskId))));
	});
}

/** The agent's task `taskId`, finished or not; unknown, or another agent's, is not found. */
export function requireTask(agent: SignedInAgent, taskId: string): Promise<Result<AgentTaskRow, ApiError>> {
	return Do(async ($) => {
		const task = $(await getAgentTask(agent.orgId, agent.agentId, taskId));
		return $(requirePresent(task, ApiErr.notFound('task', taskId)));
	});
}

/** The agent's task `taskId` for a call made for it: one finished already is refused, saying to start a new one. */
export function requireOpenTask(agent: SignedInAgent, taskId: string): Promise<Result<AgentTaskRow, ApiError>> {
	return Do(async ($) => {
		const task = $(await requireTask(agent, taskId));
		if (task.finishedAt !== null) {
			return $(Err(ApiErr.validationError(`Task ${taskId} (${task.title}) is finished. Start a new task for what you are doing now, and give its id as task.`)));
		}
		return task;
	});
}
