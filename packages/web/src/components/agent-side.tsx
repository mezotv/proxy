import {Navigate, Outlet, useLocation} from 'react-router';
import {opensWithoutTask, START_TASK_PATH, storedAgentTask} from '@/lib/agent-task';

// The agent side, behind the agent's own sign-in (the route's loader). A revoked login is signed
// out on its next page. An agent on no task is sent to start one: the loaders see to it on
// arrival, and this to a page reached from another without a loader of its own.
export function AgentSide() {
	const {pathname} = useLocation();
	if (!opensWithoutTask(pathname) && storedAgentTask() === null) {
		return <Navigate to={START_TASK_PATH} replace />;
	}
	return <Outlet />;
}
