// Path: tests/unit/streetview-projects-adapter.test.js
/**
 * @module tests/unit/streetview-projects-adapter
 * @description Unit tests for normalizeProjects: ensures the projects
 * response parser accepts both the bare-array shape and the legacy
 * `{ projects: [...] }` envelope, and always returns an array.
 */

import { describe, it, expect } from 'vitest';
import { normalizeProjects } from '../../src/js/street_view_tool/streetview-api.service.js';

describe('normalizeProjects', () => {
  it('returns a bare array as-is', () => {
    const arr = [{ id: 'a' }, { id: 'b' }];
    expect(normalizeProjects(arr)).toBe(arr);
  });

  it('unwraps the { projects: [...] } envelope', () => {
    const projects = [{ id: 'a' }];
    expect(normalizeProjects({ projects })).toBe(projects);
  });

  it('returns an empty array for null', () => {
    expect(normalizeProjects(null)).toEqual([]);
  });

  it('returns an empty array for undefined', () => {
    expect(normalizeProjects(undefined)).toEqual([]);
  });

  it('returns an empty array for an object without projects', () => {
    expect(normalizeProjects({})).toEqual([]);
  });

  it('always returns an array', () => {
    for (const input of [[], [1, 2], { projects: [] }, null, undefined, {}]) {
      expect(Array.isArray(normalizeProjects(input))).toBe(true);
    }
  });
});
