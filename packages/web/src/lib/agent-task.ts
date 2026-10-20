import type {FetchError} from '@proxy/utils';
import {useSyncExternalStore} from 'react';
import {Result} from 'ts-results-es';
import {z} from 'zod';

// The task the pages are on, kept in the browser: they send its id with every run, as the MCP
// server's calls carry `task`, so the activity log says what each request was for. An agent can
// have any number of tasks under way; the task page switches between them. In local storage, so a
// page opened in another tab is on the same task, and a page already open follows when another tab
// switches; cleared on sign-in and sign-out, so one login's task never goes with another's.

const KEY = 'agent-task';

// Told to this tab's own pages when it changes the task; other tabs hear of it as `storage`.
const CHANGED = 'agent-task-changed';

const storedSchema = z.object({id: z.string().min(1), title: z.string(), goal: z.string()});

export type StoredAgentTask = z.infer<typeof storedSchema>;

// Anything there that isn't a task, as an older build may have left, is no task.
function parseStored(raw: string | null): StoredAgentTask | null {
	if (raw === null) {
		return null;
	}
	const json = Result.wrap((): unknown => JSON.parse(raw));
	if (json.isErr()) {
		return null;
	}
	const parsed = storedSchema.safeParse(json.value);
	return parsed.success ? parsed.data : null;
}

export function storedAgentTask(): StoredAgentTask | null {
	return parseStored(localStorage.getItem(KEY));
}

function subscribe(onChange: () => void): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key === KEY || event.key === null) {
			onChange();
		}
	};
	window.addEventListener('storage', onStorage);
	window.addEventListener(CHANGED, onChange);
	return () => {
		window.removeEventListener('storage', onStorage);
		window.removeEventListener(CHANGED, onChange);
	};
}

/** The task the pages are on, as it is now: a page shows what its runs are made for, whichever tab chose it. */
export function useStoredAgentTask(): StoredAgentTask | null {
	return parseStored(useSyncExternalStore(subscribe, () => localStorage.getItem(KEY)));
}

export function storeAgentTask(task: StoredAgentTask): void {
	localStorage.setItem(KEY, JSON.stringify(task));
	window.dispatchEvent(new Event(CHANGED));
}

export function clearAgentTask(): void {
	localStorage.removeItem(KEY);
	window.dispatchEvent(new Event(CHANGED));
}

/**
 * The api refused a run for its task, not for anything else about it: the task is unknown (404 for
 * a `task`), or finished or abandoned (409). The pages let it go and send the agent to choose or
 * start another.
 */
export function isTaskRefusal(error: FetchError): boolean {
	if (error.kind !== 'http') {
		return false;
	}
	if (error.status === 409) {
		return true;
	}
	const body = error.body;
	return (
		error.status === 404 &&
		typeof body === 'object' &&
		body !== null &&
		'resource' in body &&
		body.resource === 'task'
	);
}

// Where an agent without a task is sent, and the pages that open without one: starting a task, and
// the feedback form, which an agent may need before it can start one.
export const START_TASK_PATH = '/agent/task';

export function opensWithoutTask(pathname: string): boolean {
	return pathname === START_TASK_PATH || pathname === '/agent/feedback';
}
