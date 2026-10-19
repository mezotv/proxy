/// <reference types="bun" />

import {afterEach, describe, expect, test} from 'bun:test';
import {cleanup, render, screen} from '@testing-library/react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {AgentSide} from '@/components/agent-side';
import {clearAgentTask, storeAgentTask} from '@/lib/agent-task';
import {AgentHomePage} from '@/pages/agent/agent-home-page';
import {AgentTaskPage} from '@/pages/agent/agent-task-page';

afterEach(() => {
	cleanup();
	clearAgentTask();
});

function renderAgentSide() {
	const router = createMemoryRouter(
		[
			{
				id: 'agent',
				loader: () => ({
					agent: {id: 'agent-1', providerId: 'claude', name: 'Claude'},
					connections: [],
				}),
				element: <AgentSide />,
				children: [
					{path: '/agent', element: <AgentHomePage />},
					{path: '/agent/task', loader: () => ({tasks: []}), element: <AgentTaskPage />},
				],
			},
		],
		{initialEntries: ['/agent']},
	);
	render(<RouterProvider router={router} />);
}

describe('AgentHomePage', () => {
	test('directs a login without access to the Connections page, naming the task it is on', async () => {
		storeAgentTask({id: 'task-1', title: 'Look around', goal: 'See what is connected'});
		renderAgentSide();

		expect(
			await screen.findByText(
				'No connections are available to this login yet. Ask the person who set it up to add a service on the Connections page, or give this login access to one already connected.',
			),
		).toBeDefined();
		expect(screen.getByRole('link', {name: 'Look around'}).getAttribute('href')).toBe(
			'/agent/task',
		);
		expect(screen.getByRole('button', {name: 'Finish task'})).toBeDefined();
	});

	test('sends a login on no task to start one first', async () => {
		renderAgentSide();

		expect(await screen.findByRole('heading', {name: 'Start a task'})).toBeDefined();
		expect(screen.getByRole('button', {name: 'Start task'})).toBeDefined();
		expect(screen.queryByRole('button', {name: 'Finish task'})).toBeNull();
	});
});
