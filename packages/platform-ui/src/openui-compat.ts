// The installed OpenUI 0.2.15 browser bundle otherwise loads a developer inspector
// from a remote CDN. Set its bootstrap sentinel before importing the renderer.
const runtime = globalThis as typeof globalThis & { [key: symbol]: unknown };
runtime[Symbol.for('openui.devtools.autoMount')] = true;
export {};
