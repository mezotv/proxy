import {addDays} from '@proxy/utils/days';

// Days on the browser's clock: what the activity log narrows to with `?day=`, and what the home
// page's widgets search since.

// The time zone the browser counts days in.
export function browserTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// A day on the browser's clock as the activity log narrows to it: from its midnight until the
// next one, which a change of clocks makes 23 or 25 hours later.
export function daySpan(day: string): {from: string; to: string} | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		return null;
	}
	// A date and a time without an offset is read on the browser's clock.
	const from = new Date(`${day}T00:00`);
	if (Number.isNaN(from.getTime())) {
		return null;
	}
	const to = new Date(`${addDays(day, 1)}T00:00`);
	return {from: from.toISOString(), to: to.toISOString()};
}

// "Wed, Oct 14", with the year once it is not this year's.
export function formatDay(day: string): string {
	const date = new Date(`${day}T00:00`);
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
	});
}
