import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VoxelCollision } from '../../src/js/first_person_3d_tool/walk/voxel-collision.js';
import { SOLID_LEAF_MARKER } from '../../src/js/first_person_3d_tool/walk/constants.js';

// ============================================================================
// Octree builder
// ============================================================================
//
// The real octree comes from a binary voxel.bin. To keep these tests free of
// fixture files, `buildOctree` assembles the smallest tree the traversal code
// still exercises fully:
//
//   - leafSize = 4  -> a leaf block is 4x4x4 = 64 voxels in two uint32 words
//   - treeDepth = 1 -> the root has 2x2x2 = 8 possible children (one level)
//   - grid        -> 8x8x8 voxels of `voxelResolution` metres each
//
// Node layout (identical to the production format):
//   bits 31..24 = child mask, one bit per octant (bz<<2 | by<<1 | bx)
//   bits 23..0  = first-child index when the mask is non-zero,
//                 leaf-data index when the mask is zero
//   the whole word == SOLID_LEAF_MARKER means "this subtree is fully solid"
//
// Children are stored in ascending octant order, which is what makes
// `baseOffset + popcount(mask & prefix)` land on the right one.

const LEAF_SIZE = 4;
const GRID_VOXELS = 8;

/**
 * Build a VoxelCollision over an 8x8x8 grid.
 *
 * @param {number[][]} solidVoxels - Individual solid voxels as [ix, iy, iz].
 * @param {Object} [options]
 * @param {number[][]} [options.solidBlocks] - Fully solid 4x4x4 blocks as [bx, by, bz].
 * @param {number} [options.voxelResolution] - Voxel edge in metres (default 1).
 * @param {number[]} [options.origin] - Grid minimum corner (default [0, 0, 0]).
 * @returns {VoxelCollision}
 */
function buildOctree(solidVoxels, options = {}) {
    const { solidBlocks = [], voxelResolution = 1, origin = [0, 0, 0] } = options;
    const size = GRID_VOXELS * voxelResolution;

    // octant -> [loWord, hiWord] | 'solid'
    const blocks = new Map();

    for (const [bx, by, bz] of solidBlocks) {
        blocks.set((bz << 2) | (by << 1) | bx, 'solid');
    }

    for (const [ix, iy, iz] of solidVoxels) {
        const octant =
            (Math.floor(iz / LEAF_SIZE) << 2) |
            (Math.floor(iy / LEAF_SIZE) << 1) |
            Math.floor(ix / LEAF_SIZE);
        if (blocks.get(octant) === 'solid') continue;
        let bits = blocks.get(octant);
        if (!bits) {
            bits = [0, 0];
            blocks.set(octant, bits);
        }
        const bitIndex = (iz & 3) * 16 + (iy & 3) * 4 + (ix & 3);
        if (bitIndex < 32) {
            bits[0] = (bits[0] | (1 << bitIndex)) >>> 0;
        } else {
            bits[1] = (bits[1] | (1 << (bitIndex - 32))) >>> 0;
        }
    }

    const octants = [...blocks.keys()].sort((a, b) => a - b);
    let childMask = 0;
    for (const octant of octants) {
        childMask |= 1 << octant;
    }

    const nodes = new Uint32Array(1 + octants.length);
    // Root: child mask in the high byte, first child at index 1.
    nodes[0] = (((childMask << 24) >>> 0) | 1) >>> 0;

    const leafWords = [];
    octants.forEach((octant, slot) => {
        const bits = blocks.get(octant);
        if (bits === 'solid') {
            nodes[1 + slot] = SOLID_LEAF_MARKER;
            return;
        }
        const leafIndex = leafWords.length / 2;
        leafWords.push(bits[0], bits[1]);
        nodes[1 + slot] = leafIndex >>> 0;
    });

    const metadata = {
        gridBounds: {
            min: [origin[0], origin[1], origin[2]],
            max: [origin[0] + size, origin[1] + size, origin[2] + size]
        },
        voxelResolution,
        leafSize: LEAF_SIZE,
        treeDepth: 1
    };
    return new VoxelCollision(metadata, nodes, new Uint32Array(leafWords));
}

/** An empty field: no nodes at all, which is what "octree not loaded" looks like. */
function buildEmptyField() {
    return new VoxelCollision(
        {
            gridBounds: { min: [0, 0, 0], max: [8, 8, 8] },
            voxelResolution: 1,
            leafSize: LEAF_SIZE,
            treeDepth: 1
        },
        new Uint32Array(0),
        new Uint32Array(0)
    );
}

// ============================================================================
// Builder self-check
// ============================================================================

describe('buildOctree helper', () => {
    it('round-trips every voxel of a leaf block through the bit packing', () => {
        const all = [];
        for (let iz = 0; iz < 4; iz++) {
            for (let iy = 0; iy < 4; iy++) {
                for (let ix = 0; ix < 4; ix++) {
                    all.push([ix, iy, iz]);
                }
            }
        }
        const field = buildOctree(all);
        for (const [ix, iy, iz] of all) {
            expect(field.isVoxelSolid(ix, iy, iz)).toBe(true);
        }
        // Nothing leaked into the neighbouring blocks.
        expect(field.isVoxelSolid(4, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 4, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 0, 4)).toBe(false);
    });

    it('packs the high word of a leaf (bit index >= 32)', () => {
        const field = buildOctree([[3, 3, 3]]);
        expect(field.isVoxelSolid(3, 3, 3)).toBe(true); // bitIndex 63
        expect(field.isVoxelSolid(3, 3, 2)).toBe(false);
    });
});

// ============================================================================
// isVoxelSolid
// ============================================================================

describe('VoxelCollision.isVoxelSolid', () => {
    const field = buildOctree([[0, 0, 0], [2, 0, 0], [1, 1, 1]]);

    it('reports the solid voxels', () => {
        expect(field.isVoxelSolid(0, 0, 0)).toBe(true);
        expect(field.isVoxelSolid(2, 0, 0)).toBe(true);
        expect(field.isVoxelSolid(1, 1, 1)).toBe(true);
    });

    it('reports empty voxels inside the grid', () => {
        expect(field.isVoxelSolid(1, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 1, 0)).toBe(false);
        expect(field.isVoxelSolid(7, 7, 7)).toBe(false);
    });

    it('returns false below the grid on every axis', () => {
        expect(field.isVoxelSolid(-1, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(0, -1, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 0, -1)).toBe(false);
        expect(field.isVoxelSolid(-100, -100, -100)).toBe(false);
    });

    it('returns false at and above the upper bound on every axis', () => {
        expect(field.isVoxelSolid(8, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 8, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 0, 8)).toBe(false);
        expect(field.isVoxelSolid(1000, 1000, 1000)).toBe(false);
    });

    it('returns false for NaN and Infinity indices', () => {
        expect(field.isVoxelSolid(NaN, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(0, NaN, 0)).toBe(false);
        expect(field.isVoxelSolid(0, 0, NaN)).toBe(false);
        expect(field.isVoxelSolid(Infinity, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(-Infinity, 0, 0)).toBe(false);
        expect(field.isVoxelSolid(NaN, NaN, NaN)).toBe(false);
    });

    it('returns false for every index when the octree is empty', () => {
        const empty = buildEmptyField();
        expect(empty.isVoxelSolid(0, 0, 0)).toBe(false);
        expect(empty.isVoxelSolid(4, 4, 4)).toBe(false);
    });

    it('honours a fully solid block marker', () => {
        const solidBlock = buildOctree([], { solidBlocks: [[1, 0, 0]] });
        expect(solidBlock.isVoxelSolid(4, 0, 0)).toBe(true);
        expect(solidBlock.isVoxelSolid(7, 3, 3)).toBe(true);
        // Neighbouring octants are absent from the child mask.
        expect(solidBlock.isVoxelSolid(3, 0, 0)).toBe(false);
        expect(solidBlock.isVoxelSolid(4, 4, 0)).toBe(false);
    });

    it('resolves the right child when several octants are present', () => {
        const field2 = buildOctree([[0, 0, 0], [4, 0, 0], [4, 4, 4], [7, 7, 7]]);
        expect(field2.isVoxelSolid(0, 0, 0)).toBe(true);
        expect(field2.isVoxelSolid(4, 0, 0)).toBe(true);
        expect(field2.isVoxelSolid(4, 4, 4)).toBe(true);
        expect(field2.isVoxelSolid(7, 7, 7)).toBe(true);
        expect(field2.isVoxelSolid(5, 0, 0)).toBe(false);
        expect(field2.isVoxelSolid(0, 4, 0)).toBe(false);
    });
});

// ============================================================================
// queryRay — hits and misses
// ============================================================================

describe('VoxelCollision.queryRay hits', () => {
    it('hits a voxel and reports the entry face with the right distance', () => {
        const field = buildOctree([[3, 0, 0]]);
        // From x = -2 (outside the grid) straight along +X through row y=0, z=0.
        const hit = field.queryRay(-2, 0.5, 0.5, 1, 0, 0, 10);
        expect(hit).not.toBeNull();
        expect(hit.x).toBeCloseTo(3, 10);
        expect(hit.y).toBeCloseTo(0.5, 10);
        expect(hit.z).toBeCloseTo(0.5, 10);
        expect(Math.hypot(hit.x - -2, hit.y - 0.5, hit.z - 0.5)).toBeCloseTo(5, 10);
    });

    it('hits from inside the grid', () => {
        const field = buildOctree([[3, 0, 0]]);
        const hit = field.queryRay(0.5, 0.5, 0.5, 1, 0, 0, 10);
        expect(hit).not.toBeNull();
        expect(hit.x).toBeCloseTo(3, 10);
    });

    it('reports a hit at t = 0 when the origin is already inside a solid voxel', () => {
        const field = buildOctree([[0, 0, 0]]);
        const hit = field.queryRay(0.5, 0.5, 0.5, 1, 0, 0, 10);
        expect(hit).not.toBeNull();
        expect(hit.x).toBeCloseTo(0.5, 10);
    });

    it('scales with voxelResolution and a shifted grid origin', () => {
        // Voxel (1,0,0) of a 0.5 m grid anchored at (-10, -10, -10)
        // occupies x in [-9.5, -9.0].
        const field = buildOctree([[1, 0, 0]], { voxelResolution: 0.5, origin: [-10, -10, -10] });
        const hit = field.queryRay(-12, -9.75, -9.75, 1, 0, 0, 10);
        expect(hit).not.toBeNull();
        expect(hit.x).toBeCloseTo(-9.5, 10);
    });
});

describe('VoxelCollision.queryRay misses', () => {
    it('returns null when the ray crosses only empty voxels', () => {
        const field = buildOctree([[3, 0, 0]]);
        // Same direction, but through an empty row (y = 6.5).
        expect(field.queryRay(-2, 6.5, 0.5, 1, 0, 0, 100)).toBeNull();
    });

    it('returns null when the ray never enters the grid box', () => {
        const field = buildOctree([[0, 0, 0]]);
        expect(field.queryRay(-2, 100, 0.5, 1, 0, 0, 100)).toBeNull();
        expect(field.queryRay(-2, 0.5, 0.5, -1, 0, 0, 100)).toBeNull(); // pointing away
    });

    it('returns null when the octree is empty', () => {
        const empty = buildEmptyField();
        expect(empty.queryRay(-2, 0.5, 0.5, 1, 0, 0, 100)).toBeNull();
    });

    it('stops at maxDist even when a solid voxel lies further along', () => {
        const field = buildOctree([[3, 0, 0]]);
        // The face of voxel 3 sits 5 m away; 4 m of range must not reach it.
        expect(field.queryRay(-2, 0.5, 0.5, 1, 0, 0, 4)).toBeNull();
        expect(field.queryRay(-2, 0.5, 0.5, 1, 0, 0, 5.01)).not.toBeNull();
    });
});

// ============================================================================
// queryRay — degenerate directions (the classic slab divide-by-zero)
// ============================================================================

describe('VoxelCollision.queryRay with axis-aligned directions', () => {
    it('probes the ground straight down (dx = dz = 0)', () => {
        const field = buildOctree([[0, 0, 0]]);
        const hit = field.queryRay(0.5, 5, 0.5, 0, -1, 0, 10);
        expect(hit).not.toBeNull();
        expect(hit.x).toBeCloseTo(0.5, 10);
        expect(hit.y).toBeCloseTo(1, 10); // top face of voxel iy = 0
        expect(hit.z).toBeCloseTo(0.5, 10);
    });

    it('returns null for a downward probe over an empty column', () => {
        const field = buildOctree([[0, 0, 0]]);
        expect(field.queryRay(5.5, 5, 5.5, 0, -1, 0, 10)).toBeNull();
    });

    it('returns null when a zero direction component sits outside its slab', () => {
        const field = buildOctree([[0, 0, 0]]);
        // dy = 0 and y = 20 is outside [0, 8): the slab test rejects it before
        // any division happens.
        expect(field.queryRay(-2, 20, 0.5, 1, 0, 0, 100)).toBeNull();
    });

    it('returns null for a fully zero direction outside a solid voxel', () => {
        const field = buildOctree([[0, 0, 0]]);
        expect(field.queryRay(5.5, 5.5, 5.5, 0, 0, 0, 10)).toBeNull();
    });

    it('walks along each axis in both signs', () => {
        const field = buildOctree([[3, 3, 3]]);
        expect(field.queryRay(3.5, 3.5, -2, 0, 0, 1, 100)).not.toBeNull();
        expect(field.queryRay(3.5, 3.5, 20, 0, 0, -1, 100)).not.toBeNull();
        expect(field.queryRay(-2, 3.5, 3.5, 1, 0, 0, 100)).not.toBeNull();
        expect(field.queryRay(20, 3.5, 3.5, -1, 0, 0, 100)).not.toBeNull();
        expect(field.queryRay(3.5, -2, 3.5, 0, 1, 0, 100)).not.toBeNull();
        expect(field.queryRay(3.5, 20, 3.5, 0, -1, 0, 100)).not.toBeNull();
    });
});

// ============================================================================
// queryRay — maxDist boundaries
// ============================================================================

describe('VoxelCollision.queryRay maxDist boundaries', () => {
    const field = buildOctree([[0, 0, 0]]);

    it('returns null for maxDist = 0 from outside the grid', () => {
        expect(field.queryRay(-2, 0.5, 0.5, 1, 0, 0, 0)).toBeNull();
    });

    it('returns the origin for maxDist = 0 started inside a solid voxel', () => {
        // Faithful to the original: the DDA always tests the entry voxel once.
        const hit = field.queryRay(0.5, 0.5, 0.5, 1, 0, 0, 0);
        expect(hit).not.toBeNull();
        expect(hit.x).toBeCloseTo(0.5, 10);
    });

    it('returns null for a negative maxDist, inside or outside', () => {
        expect(field.queryRay(-2, 0.5, 0.5, 1, 0, 0, -1)).toBeNull();
        expect(field.queryRay(0.5, 0.5, 0.5, 1, 0, 0, -1)).toBeNull();
        expect(field.queryRay(0.5, 0.5, 0.5, 1, 0, 0, -Infinity)).toBeNull();
    });
});

// ============================================================================
// queryRay — non-finite inputs
// ============================================================================

describe('VoxelCollision.queryRay with NaN and Infinity', () => {
    const field = buildOctree([[0, 0, 0], [3, 0, 0]]);

    it('returns null for a NaN origin component', () => {
        expect(field.queryRay(NaN, 0.5, 0.5, 1, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-2, NaN, 0.5, 1, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-2, 0.5, NaN, 1, 0, 0, 10)).toBeNull();
    });

    it('returns null for a NaN direction component', () => {
        expect(field.queryRay(-2, 0.5, 0.5, NaN, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-2, 0.5, 0.5, 1, NaN, 0, 10)).toBeNull();
        expect(field.queryRay(-2, 0.5, 0.5, 1, 0, NaN, 10)).toBeNull();
    });

    it('returns null for an infinite origin component', () => {
        expect(field.queryRay(Infinity, 0.5, 0.5, 1, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-Infinity, 0.5, 0.5, 1, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-2, Infinity, 0.5, 1, 0, 0, 10)).toBeNull();
    });

    it('returns null for an infinite direction component', () => {
        // Without the finite guard this one reaches the DDA with NaN voxel
        // indices and can report a bogus hit.
        expect(field.queryRay(-2, 0.5, 0.5, Infinity, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-2, 0.5, 0.5, -Infinity, 0, 0, 10)).toBeNull();
        expect(field.queryRay(-2, 0.5, 0.5, 1, Infinity, 0, 10)).toBeNull();
    });

    it('returns null for a NaN maxDist', () => {
        expect(field.queryRay(-2, 0.5, 0.5, 1, 0, 0, NaN)).toBeNull();
    });
});

// ============================================================================
// queryRay — invariants
// ============================================================================

describe('VoxelCollision.queryRay invariants', () => {
    // A scattered field, so random rays sometimes hit and sometimes miss.
    const field = buildOctree([
        [0, 0, 0], [1, 2, 3], [3, 3, 3], [5, 1, 6], [6, 6, 6], [2, 5, 1]
    ]);

    it('never reports a hit outside the grid box or beyond maxDist', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                fc.double({ min: 0, max: 60, noNaN: true }),
                (ox, oy, oz, rx, ry, rz, maxDist) => {
                    const len = Math.hypot(rx, ry, rz);
                    if (len < 1e-6) return true; // not a direction
                    const hit = field.queryRay(ox, oy, oz, rx / len, ry / len, rz / len, maxDist);
                    if (hit === null) return true;
                    const EPS = 1e-6;
                    expect(Number.isFinite(hit.x)).toBe(true);
                    expect(Number.isFinite(hit.y)).toBe(true);
                    expect(Number.isFinite(hit.z)).toBe(true);
                    expect(hit.x).toBeGreaterThanOrEqual(-EPS);
                    expect(hit.y).toBeGreaterThanOrEqual(-EPS);
                    expect(hit.z).toBeGreaterThanOrEqual(-EPS);
                    expect(hit.x).toBeLessThanOrEqual(8 + EPS);
                    expect(hit.y).toBeLessThanOrEqual(8 + EPS);
                    expect(hit.z).toBeLessThanOrEqual(8 + EPS);
                    const travelled = Math.hypot(hit.x - ox, hit.y - oy, hit.z - oz);
                    expect(travelled).toBeLessThanOrEqual(maxDist + 1e-6);
                    return true;
                }
            ),
            { numRuns: 400 }
        );
    });

    it('never reports a hit when the field has no solid voxel', () => {
        const empty = buildOctree([]);
        fc.assert(
            fc.property(
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -20, max: 20, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                (ox, oy, oz, rx, ry, rz) => {
                    const len = Math.hypot(rx, ry, rz);
                    if (len < 1e-6) return true;
                    return empty.queryRay(ox, oy, oz, rx / len, ry / len, rz / len, 60) === null;
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// queryCapsule
// ============================================================================

describe('VoxelCollision.queryCapsule', () => {
    it('pushes a capsule out of a nearby solid voxel along the shallow axis', () => {
        const field = buildOctree([[0, 0, 0]]); // voxel spans [0,1]^3
        const out = { x: 0, y: 0, z: 0 };
        // Centre 0.05 m from the +X face, radius 0.2 -> 0.15 m of penetration.
        const pushed = field.queryCapsule(1.05, 0.5, 0.5, 0.3, 0.2, out);
        expect(pushed).toBe(true);
        expect(out.x).toBeCloseTo(0.15, 6);
        expect(out.y).toBeCloseTo(0, 6);
        expect(out.z).toBeCloseTo(0, 6);
    });

    it('leaves the output untouched when nothing is penetrated', () => {
        const field = buildOctree([[0, 0, 0]]);
        const out = { x: 111, y: 222, z: 333 };
        expect(field.queryCapsule(6, 6, 6, 0.3, 0.2, out)).toBe(false);
        expect(out).toEqual({ x: 111, y: 222, z: 333 });
    });

    it('resolves a capsule whose centre sits exactly inside a voxel', () => {
        const field = buildOctree([[0, 0, 0]]);
        const out = { x: 0, y: 0, z: 0 };
        expect(field.queryCapsule(0.5, 0.5, 0.5, 0.3, 0.2, out)).toBe(true);
        expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThan(0);
    });

    it('returns false when the octree is empty', () => {
        const empty = buildEmptyField();
        const out = { x: 0, y: 0, z: 0 };
        expect(empty.queryCapsule(0.5, 0.5, 0.5, 0.3, 0.2, out)).toBe(false);
    });

    it('returns false for non-finite arguments', () => {
        const field = buildOctree([[0, 0, 0]]);
        const out = { x: 0, y: 0, z: 0 };
        expect(field.queryCapsule(NaN, 0.5, 0.5, 0.3, 0.2, out)).toBe(false);
        expect(field.queryCapsule(0.5, NaN, 0.5, 0.3, 0.2, out)).toBe(false);
        expect(field.queryCapsule(0.5, 0.5, Infinity, 0.3, 0.2, out)).toBe(false);
        expect(field.queryCapsule(0.5, 0.5, 0.5, NaN, 0.2, out)).toBe(false);
        expect(field.queryCapsule(0.5, 0.5, 0.5, 0.3, Infinity, out)).toBe(false);
        expect(out).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('returns false for a zero radius against a voxel it only touches', () => {
        const field = buildOctree([[0, 0, 0]]);
        const out = { x: 0, y: 0, z: 0 };
        expect(field.queryCapsule(1.05, 0.5, 0.5, 0.3, 0, out)).toBe(false);
    });
});
