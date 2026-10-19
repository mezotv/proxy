import {z} from 'zod';

// The task the pages are on, kept in the browser: they send its id with every run, as the MCP
// server's calls carry `task`, so the activity log says what each request was for. An agent can
// have any number of tasks under way; the task page switches between them. In local storage, so a
// page opened in another tab is on the same task; cleared on sign-in and sign-out, so one login's
// task never goes with another's.

const KEY = 'agent-task';

const storedSchema = z.object({id: z.string().min(1), title: z.string(), goal: z.string()});

export type StoredAgentTask = z.infer<typeof storedSchema>;

export function storedAgentTask(): StoredAgentTask | null {
	const raw = localStorage.getItem(KEY);
	if (raw === null) {
		return null;
	}
	const parsed = storedSchema.safeParse(JSON.parse(raw));
	return parsed.success ? parsed.data : null;
}

export function storeAgentTask(task: StoredAgentTask): void {
	localStorage.setItem(KEY, JSON.stringify(task));
}

export function clearAgentTask(): void {
	localStorage.removeItem(KEY);
}

// Where an agent without a task is sent, and the pages that open without one: starting a task, and
// the feedback form, which an agent may need before it can start one.
export const START_TASK_PATH = '/agent/task';

export function opensWithoutTask(pathname: string): boolean {
	return pathname === START_TASK_PATH || pathname === '/agent/feedback';
}
