import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const res = require('./src/extension/engine/context-engine.js');
console.log("Exports:", Object.keys(res));
