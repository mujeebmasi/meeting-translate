// Checked in a few places (the gateway, the controller, main.ts's startup
// warning) that don't otherwise share a module, so it's pulled out here
// once rather than repeating `process.env.MOCK === '1'` at each call site.
export const MOCK = process.env.MOCK === '1';
