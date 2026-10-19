export function loadPlugin(name: string): Promise<unknown> { return import(name); }
