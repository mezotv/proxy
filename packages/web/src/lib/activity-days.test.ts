import {describe, expect, test} from 'bun:test';
import {daySpan} from '@/lib/activity-days';

describe('daySpan', () => {
	test('a day spans midnight to midnight on the browser’s clock', () => {
		const span = daySpan('2026-10-14');

		expect(span?.from).toBe(new Date(2026, 9, 14).toISOString());
		expect(span?.to).toBe(new Date(2026, 9, 15).toISOString());
		expect(daySpan('yesterday')).toBeNull();
		expect(daySpan('2026-13-45')).toBeNull();
	});
});
