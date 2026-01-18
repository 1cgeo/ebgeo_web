// Path: js/events/index.js

/**
 * @fileoverview Barrel file for events module.
 * Exports event bus, emitter, and type constants.
 */

export { EventBus, createEventBus } from './event_bus.js';
export { EventEmitter } from './event_emitter.js';
export { EventTypes, FeatureUpdateProperty, EventPayloads } from './event_types.js';
