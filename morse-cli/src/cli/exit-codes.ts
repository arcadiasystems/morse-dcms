/** Process exit codes. Documented in README and `morse --help`. */
export const ExitCode = {
	Success: 0,
	Generic: 1,
	Usage: 2,
	NotFound: 3,
	Auth: 4,
	Network: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
