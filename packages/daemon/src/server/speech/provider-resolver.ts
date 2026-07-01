export type Resolvable<T> = T | (() => T | Promise<T>);
