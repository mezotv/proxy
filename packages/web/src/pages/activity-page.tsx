import {XIcon} from 'lucide-react';
import {useLoaderData, useSearchParams} from 'react-router';
import {AppShell, PageTitle} from '@/components/app-shell';
import {AuditList} from '@/components/audit-list';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@proxy/ui/components/select';
import {Button} from '@proxy/ui/components/button';
import {AgentLogo} from '@/components/brand-logo';
import {Badge} from '@proxy/ui/components/badge';
import {connectionLabel} from '@/lib/access';
import {daySpan, formatDay} from '@/lib/activity-days';
import {formatDateTime} from '@/lib/format';
import type {ActivityTask, AgentLogin} from '@/lib/types';
import type {activityLoader} from '@/loaders';

const ALL = 'all';

type Option = {value: string; label: string};

const OUTCOMES: Option[] = [
	{value: ALL, label: 'All outcomes'},
	{value: 'allowed', label: 'Allowed'},
	{value: 'denied', label: 'Blocked'},
];

// Every request an agent made, and what Personal Agent Proxy did itself from the home page,
// newest first, narrowed by agent, connection and outcome, to a day, and to one agent's task. The
// filters live in the URL, so the agent and connection pages, the home page's graph and an entry's
// task can link straight to their part of the log, and the api applies them (`?agent=proxy` for
// Personal Agent Proxy's own, `?outcome=denied` for what was refused, `?day=2026-10-14` for a day
// on the browser's clock, `?task=` for the requests made for one task).
export function ActivityPage() {
	const {
		entries,
		tasks,
		agents: allAgents,
		connections: allConnections,
	} = useLoaderData<typeof activityLoader>();
	const [params, setParams] = useSearchParams();
	const agent = params.get('agent') ?? ALL;
	const connection = params.get('connection') ?? ALL;
	const outcome = params.get('outcome') ?? ALL;
	const day = params.get('day');
	const taskId = params.get('task');
	const task = tasks.find((candidate) => candidate.id === taskId);
	const filter = (key: string, value: string) => {
		const next = new URLSearchParams(params);
		if (value === ALL) {
			next.delete(key);
		}
		if (value !== ALL) {
			next.set(key, value);
		}
		setParams(next, {replace: true});
	};

	const agents: Option[] = [
		{value: ALL, label: 'All agents'},
		{value: 'proxy', label: 'Personal Agent Proxy'},
		...allAgents.map((candidate) => ({value: candidate.id, label: candidate.name})),
	];
	const connections: Option[] = [
		{value: ALL, label: 'All connections'},
		...allConnections.map((candidate) => ({
			value: candidate.id,
			label: connectionLabel(allConnections, candidate),
		})),
	];

	return (
		<AppShell title={<PageTitle detail={`${entries.length} requests`}>Activity</PageTitle>}>
			<div className="mb-3 flex flex-wrap gap-2 md:flex-nowrap md:px-3">
				<Filter
					label="Agent"
					options={agents}
					value={agent}
					onChange={(value) => filter('agent', value)}
				/>
				<Filter
					label="Connection"
					options={connections}
					value={connection}
					onChange={(value) => filter('connection', value)}
				/>
				<Filter
					label="Outcome"
					options={OUTCOMES}
					value={outcome}
					onChange={(value) => filter('outcome', value)}
				/>
				{day && daySpan(day) && (
					<Button variant="outline" size="sm" onClick={() => filter('day', ALL)}>
						{formatDay(day)}
						<XIcon data-icon="inline-end" />
						<span className="sr-only">Show every day</span>
					</Button>
				)}
			</div>
			{task && (
				<TaskCard
					task={task}
					agent={allAgents.find((candidate) => candidate.id === task.agentId)}
					onClear={() => filter('task', ALL)}
				/>
			)}
			<AuditList entries={entries} agents={allAgents} connections={allConnections} tasks={tasks} />
		</AppShell>
	);
}

// The task the log is narrowed to: what the agent said it set out to do, when it started, and
// whether it has called it finished. The X in its corner widens the log to every task again.
function TaskCard({
	task,
	agent,
	onClear,
}: {
	task: ActivityTask;
	agent: AgentLogin | undefined;
	onClear: () => void;
}) {
	return (
		<div className="relative mb-3 rounded-lg border px-4 py-3 pr-12 text-sm md:mx-3">
			<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" onClick={onClear}>
				<XIcon />
				<span className="sr-only">Show every task</span>
			</Button>
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium">{task.title}</span>
				{task.finishedAt ? (
					<Badge variant="secondary">Finished</Badge>
				) : (
					<Badge variant="outline">Under way</Badge>
				)}
			</div>
			<p className="mt-1 text-muted-foreground">{task.goal}</p>
			<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
				{agent && (
					<span className="inline-flex items-center gap-1.5">
						<AgentLogo providerId={agent.providerId} />
						{agent.name}
					</span>
				)}
				{!agent && <span>Deleted agent</span>}
				<span aria-hidden>·</span>
				<span>Started {formatDateTime(task.startedAt)}</span>
				{task.finishedAt && (
					<>
						<span aria-hidden>·</span>
						<span>Finished {formatDateTime(task.finishedAt)}</span>
					</>
				)}
				{task.via === 'mcp' && (
					<>
						<span aria-hidden>·</span>
						<span>Over MCP</span>
					</>
				)}
			</p>
		</div>
	);
}

type FilterProps = {
	label: string;
	options: Option[];
	value: string;
	onChange: (value: string) => void;
};

function Filter({label, options, value, onChange}: FilterProps) {
	return (
		<Select
			value={value}
			items={options}
			onValueChange={(next) => {
				if (next !== null) {
					onChange(next);
				}
			}}
		>
			<SelectTrigger
				size="sm"
				aria-label={label}
				className="min-w-0 flex-1 basis-[calc(50%-0.25rem)] md:w-48 md:flex-none md:basis-auto"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={false}>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
