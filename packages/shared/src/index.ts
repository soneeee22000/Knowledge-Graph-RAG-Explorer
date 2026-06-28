/**
 * @kg/shared — the agent/human protocol.
 *
 * Every cross-boundary type in the system is defined here as a Zod schema and
 * re-exported alongside its inferred TS type. Import from `@kg/shared` in both
 * the backend and the frontend; never redefine these shapes locally.
 */
export * from './domain.js';
export * from './events.js';
export * from './api.js';
