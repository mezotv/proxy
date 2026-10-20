import type {FetchError} from '@proxy/utils';
import {redirect} from 'react-router';
import type {Result} from 'ts-results-es';
import {toolName} from '@proxy/integrations';
import {
	getAgentMe,
	listAgentTasks,
	runAgentListTool,
	runAgentRecordTool,
} from '@/client/agent-client';
import type {DataRecord} from '@/lib/types';
import {isNotFoundError, isUnauthenticatedError} from '@/client/me-client';
import {
	clearAgentTask,
	isTaskRefusal,
	opensWithoutTask,
	START_TASK_PATH,
	storedAgentTask,
} from '@/lib/agent-task';
import {fetchErrorToResponse} from '@/lib/loader-utils';

// The agent side's pages. Every records request is made for the task the agent is on, checked and
// logged by the api; a page shows what came back, a refusal included. An agent that is on no task
// is sent to start one before any page that would make a request.

function requireStoredTask(): void {
	if (storedAgentTask() === null) {
		throw redirect(START_TASK_PATH);
	}
}

// No live session, a revoked login included, sends the agent to its sign-in.
function unwrapAgentResult<T>(result: Result<T, FetchError>): T {
	if (result.isOk()) {
		return result.value;
	}
	if (isUnauthenticatedError(result.error)) {
		throw redirect('/agent/login');
	}
	throw fetchErrorToResponse(result.error);
}

export type Outcome<T> = {kind: 'ok'; value: T} | {kind: 'denied'} | {kind: 'missing'};

// A run refused for its task, one another tab finished or a day left abandoned, lets the task go
// and sends the agent to choose or start another, rather than show the page as refused or missing.
function toOutcome<T>(result: Result<T, FetchError>): Outcome<T> {
	if (result.isErr() && isTaskRefusal(result.error)) {
		clearAgentTask();
		throw redirect(START_TASK_PATH);
	}
	if (result.isErr() && result.error.kind === 'http' && result.error.status === 403) {
		return {kind: 'denied'};
	}
	if (result.isErr() && isNotFoundError(result.error)) {
		return {kind: 'missing'};
	}
	return {kind: 'ok', value: unwrapAgentResult(result)};
}

export async function agentSideLoader({request}: {request: Request}) {
	if (!opensWithoutTask(new URL(request.url).pathname)) {
		requireStoredTask();
	}
	return unwrapAgentResult(await getAgentMe());
}

// The task page: the agent's tasks under way, to switch between or finish.
export async function agentTasksLoader() {
	return unwrapAgentResult(await listAgentTasks());
}

type Params = {connectionId?: string; collectionId?: string; recordId?: string};

// The address's query is the list tool's params as they are: `?search=`, `?page=` and the
// collection's filter field, such as `?folder=Draft`. The api refuses any it doesn't take.
export async function agentCollectionLoader({params, request}: {params: Params; request: Request}) {
	requireStoredTask();
	const query = Object.fromEntries(new URL(request.url).searchParams);
	return toOutcome(
		await runAgentListTool(
			params.connectionId ?? '',
			toolName(params.collectionId ?? '', 'list'),
			query,
		),
	);
}

export async function agentRecordLoader({params}: {params: Params}): Promise<Outcome<DataRecord>> {
	requireStoredTask();
	const result = await runAgentRecordTool(
		params.connectionId ?? '',
		toolName(params.collectionId ?? '', 'view'),
		{id: params.recordId ?? ''},
	);
	const outcome = toOutcome(result);
	if (outcome.kind !== 'ok') {
		return outcome;
	}
	const {record} = outcome.value;
	if (!record) {
		return {kind: 'missing'};
	}
	return {kind: 'ok', value: record};
}
