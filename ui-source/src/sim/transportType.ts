/**
 * How a request reaches the engine: `(route, body) => the parsed answer`. A leaf module on purpose, so the engine
 * client can name the type without depending on the services above it.
 */
export type Transport = (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown>;
