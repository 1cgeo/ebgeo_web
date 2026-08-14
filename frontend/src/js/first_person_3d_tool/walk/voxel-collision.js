// Path: js/first_person_3d_tool/walk/voxel-collision.js
/**
 * @fileoverview Sparse voxel collision field: point occupancy, raycast and
 * capsule push-out.
 *
 * Ported from museu-gs/walk-core.ts, which extracted it from
 * website/src/content/examples/walk-demo.ts of manycoretech/aholo-viewer (MIT),
 * itself derived from the SuperSplat Viewer. The maths is unchanged.
 *
 * Pure module: no DOM, no viewer imports. This is what holds up walking, label
 * occlusion and the measuring tape, so it is also the one unit-testable piece.
 */

import {
    SOLID_LEAF_MARKER,
    PENETRATION_EPSILON,
    MAX_RESOLVE_ITERATIONS
} from './constants.js';

/**
 * Population count of a 32-bit word.
 * @param {number} n - Word to count bits in.
 * @returns {number} Number of set bits.
 */
function popcount(n) {
    n >>>= 0;
    n -= (n >>> 1) & 0x55555555;
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * @typedef {Object} VoxelMetadata
 * @property {{min: number[], max: number[]}} gridBounds - Grid extent in metres.
 * @property {number} voxelResolution - Edge of one voxel, in metres.
 * @property {number} leafSize - Edge of one leaf block, in voxels (4).
 * @property {number} treeDepth - Octree levels above the leaf blocks.
 */

/**
 * @typedef {Object} Vec3Like
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * Sparse voxel collision field. The walk controller only needs point occupancy,
 * raycast and capsule push-out.
 */
export class VoxelCollision {
    /** @type {Vec3Like} */
    #scratchPush = { x: 0, y: 0, z: 0 };

    /** @type {Vec3Like[]} */
    #contactNormals = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 }
    ];

    /**
     * @param {VoxelMetadata} metadata - Grid description from voxel-meta.json.
     * @param {Uint32Array} nodes - Packed octree nodes.
     * @param {Uint32Array} leafData - Packed leaf bitmasks, two words per leaf.
     */
    constructor(metadata, nodes, leafData) {
        this.gridMinX = metadata.gridBounds.min[0];
        this.gridMinY = metadata.gridBounds.min[1];
        this.gridMinZ = metadata.gridBounds.min[2];
        const voxelSize = metadata.voxelResolution;
        this.voxelCountX = Math.round((metadata.gridBounds.max[0] - metadata.gridBounds.min[0]) / voxelSize);
        this.voxelCountY = Math.round((metadata.gridBounds.max[1] - metadata.gridBounds.min[1]) / voxelSize);
        this.voxelCountZ = Math.round((metadata.gridBounds.max[2] - metadata.gridBounds.min[2]) / voxelSize);
        this.voxelSize = voxelSize;
        this.leafSize = metadata.leafSize;
        this.treeDepth = metadata.treeDepth;
        this.nodes = nodes;
        this.leafData = leafData;
    }

    /**
     * Fast point occupancy lookup.
     *
     * The bounds test is written as negated comparisons (`!(ix >= 0)` instead of
     * `ix < 0`) so that NaN indices fall out here instead of walking the octree
     * with a NaN-derived octant. Same cost, same result for every finite index.
     *
     * @param {number} ix - Voxel index on X.
     * @param {number} iy - Voxel index on Y.
     * @param {number} iz - Voxel index on Z.
     * @returns {boolean} True when the voxel is solid.
     */
    isVoxelSolid(ix, iy, iz) {
        if (
            this.nodes.length === 0 ||
            !(ix >= 0) ||
            !(iy >= 0) ||
            !(iz >= 0) ||
            !(ix < this.voxelCountX) ||
            !(iy < this.voxelCountY) ||
            !(iz < this.voxelCountZ)
        ) {
            return false;
        }
        const blockX = Math.floor(ix / this.leafSize);
        const blockY = Math.floor(iy / this.leafSize);
        const blockZ = Math.floor(iz / this.leafSize);
        let nodeIndex = 0;
        for (let level = this.treeDepth - 1; level >= 0; level--) {
            const node = this.nodes[nodeIndex] >>> 0;
            if (node === SOLID_LEAF_MARKER) {
                return true;
            }
            const childMask = (node >>> 24) & 0xff;
            if (childMask === 0) {
                return this.#checkLeafByIndex(node, ix, iy, iz);
            }
            const bitX = (blockX >>> level) & 1;
            const bitY = (blockY >>> level) & 1;
            const bitZ = (blockZ >>> level) & 1;
            const octant = (bitZ << 2) | (bitY << 1) | bitX;
            if ((childMask & (1 << octant)) === 0) {
                return false;
            }
            const baseOffset = node & 0x00ffffff;
            const prefix = (1 << octant) - 1;
            nodeIndex = baseOffset + popcount(childMask & prefix);
        }
        const node = this.nodes[nodeIndex] >>> 0;
        if (node === SOLID_LEAF_MARKER) {
            return true;
        }
        return this.#checkLeafByIndex(node, ix, iy, iz);
    }

    /**
     * Raycast through voxels for ground snaps and camera blocking checks.
     *
     * Amanatides-Woo DDA preceded by a slab test against the grid box. The slab
     * helper treats a near-zero direction component as "no crossing on this
     * axis", which is what keeps the classic divide-by-zero out of axis-aligned
     * rays (the ground probe shoots straight down).
     *
     * @param {number} ox - Ray origin X.
     * @param {number} oy - Ray origin Y.
     * @param {number} oz - Ray origin Z.
     * @param {number} dx - Ray direction X (expected normalised).
     * @param {number} dy - Ray direction Y.
     * @param {number} dz - Ray direction Z.
     * @param {number} maxDist - Maximum travel, in metres.
     * @returns {Vec3Like|null} Hit point, or null when nothing is hit.
     */
    queryRay(ox, oy, oz, dx, dy, dz, maxDist) {
        if (this.nodes.length === 0) {
            return null;
        }
        // Guard added on the port: a non-finite direction survives the slab test
        // (Infinity * 0 is NaN only later) and reaches the DDA with NaN indices.
        // Note that `?? 0` would not catch NaN here — only Number.isFinite does.
        if (
            !Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz) ||
            !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) ||
            !Number.isFinite(maxDist)
        ) {
            return null;
        }
        const voxelSize = this.voxelSize;
        const gMinX = this.gridMinX;
        const gMinY = this.gridMinY;
        const gMinZ = this.gridMinZ;
        const gMaxX = gMinX + this.voxelCountX * voxelSize;
        const gMaxY = gMinY + this.voxelCountY * voxelSize;
        const gMaxZ = gMinZ + this.voxelCountZ * voxelSize;
        const EPS = 1e-12;

        let tNear = 0;
        let tFar = maxDist;
        const slab = (o, d, min, max) => {
            if (Math.abs(d) <= EPS) {
                return o >= min && o < max;
            }
            let t1 = (min - o) / d;
            let t2 = (max - o) / d;
            if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
            }
            if (t1 > tNear) {
                tNear = t1;
            }
            tFar = Math.min(tFar, t2);
            return tNear <= tFar;
        };
        if (!slab(ox, dx, gMinX, gMaxX) || !slab(oy, dy, gMinY, gMaxY) || !slab(oz, dz, gMinZ, gMaxZ)) {
            return null;
        }
        const entryX = ox + dx * tNear;
        const entryY = oy + dy * tNear;
        const entryZ = oz + dz * tNear;
        let ix = Math.max(0, Math.min(Math.floor((entryX - gMinX) / voxelSize), this.voxelCountX - 1));
        let iy = Math.max(0, Math.min(Math.floor((entryY - gMinY) / voxelSize), this.voxelCountY - 1));
        let iz = Math.max(0, Math.min(Math.floor((entryZ - gMinZ) / voxelSize), this.voxelCountZ - 1));

        const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
        const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
        const invDx = Math.abs(dx) > EPS ? 1 / dx : 0;
        const invDy = Math.abs(dy) > EPS ? 1 / dy : 0;
        const invDz = Math.abs(dz) > EPS ? 1 / dz : 0;
        let tMaxX = Math.abs(dx) > EPS ? (gMinX + (ix + (dx > 0 ? 1 : 0)) * voxelSize - ox) * invDx : Infinity;
        let tMaxY = Math.abs(dy) > EPS ? (gMinY + (iy + (dy > 0 ? 1 : 0)) * voxelSize - oy) * invDy : Infinity;
        let tMaxZ = Math.abs(dz) > EPS ? (gMinZ + (iz + (dz > 0 ? 1 : 0)) * voxelSize - oz) * invDz : Infinity;
        const tDeltaX = Math.abs(dx) > EPS ? voxelSize * Math.abs(invDx) : Infinity;
        const tDeltaY = Math.abs(dy) > EPS ? voxelSize * Math.abs(invDy) : Infinity;
        const tDeltaZ = Math.abs(dz) > EPS ? voxelSize * Math.abs(invDz) : Infinity;
        let currentT = tNear;

        const maxSteps = this.voxelCountX + this.voxelCountY + this.voxelCountZ;
        for (let i = 0; i < maxSteps; i++) {
            if (this.isVoxelSolid(ix, iy, iz)) {
                return { x: ox + dx * currentT, y: oy + dy * currentT, z: oz + dz * currentT };
            }
            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    currentT = tMaxX;
                    ix += stepX;
                    tMaxX += tDeltaX;
                } else {
                    currentT = tMaxZ;
                    iz += stepZ;
                    tMaxZ += tDeltaZ;
                }
            } else if (tMaxY < tMaxZ) {
                currentT = tMaxY;
                iy += stepY;
                tMaxY += tDeltaY;
            } else {
                currentT = tMaxZ;
                iz += stepZ;
                tMaxZ += tDeltaZ;
            }
            if (
                ix < 0 ||
                iy < 0 ||
                iz < 0 ||
                ix >= this.voxelCountX ||
                iy >= this.voxelCountY ||
                iz >= this.voxelCountZ ||
                currentT > maxDist
            ) {
                return null;
            }
        }
        return null;
    }

    /**
     * Resolve a vertical capsule out of solid voxels.
     *
     * @param {number} cx - Capsule centre X.
     * @param {number} cy - Capsule centre Y.
     * @param {number} cz - Capsule centre Z.
     * @param {number} halfHeight - Half the length of the capsule segment.
     * @param {number} radius - Capsule radius.
     * @param {Vec3Like} out - Receives the accumulated push when one is needed.
     * @returns {boolean} True when `out` was written.
     */
    queryCapsule(cx, cy, cz, halfHeight, radius, out) {
        // Guard added on the port: a non-finite centre turns the voxel index
        // range into NaN and the triple loop below silently does nothing, while
        // a non-finite radius would make every voxel look penetrated.
        if (
            !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz) ||
            !Number.isFinite(halfHeight) || !Number.isFinite(radius)
        ) {
            return false;
        }
        return this.#resolveIterative(
            cx,
            cy,
            cz,
            (rx, ry, rz, push) => this.#resolveDeepestPenetrationCapsule(rx, ry, rz, halfHeight, radius, push),
            out
        );
    }

    /**
     * Read one packed leaf bit. A leaf holds 4x4x4 voxels in two uint32 words.
     *
     * @param {number} node - Node word; its low 24 bits are the leaf index.
     * @param {number} ix - Voxel index on X.
     * @param {number} iy - Voxel index on Y.
     * @param {number} iz - Voxel index on Z.
     * @returns {boolean} True when the bit is set.
     */
    #checkLeafByIndex(node, ix, iy, iz) {
        const leafDataIndex = node & 0x00ffffff;
        const vx = ix & 3;
        const vy = iy & 3;
        const vz = iz & 3;
        const bitIndex = vz * 16 + vy * 4 + vx;
        if (bitIndex < 32) {
            const lo = this.leafData[leafDataIndex * 2] >>> 0;
            return ((lo >>> bitIndex) & 1) === 1;
        }
        const hi = this.leafData[leafDataIndex * 2 + 1] >>> 0;
        return ((hi >>> (bitIndex - 32)) & 1) === 1;
    }

    /**
     * Find the strongest push needed to move a capsule out of nearby solid voxels.
     *
     * @param {number} cx - Capsule centre X.
     * @param {number} cy - Capsule centre Y.
     * @param {number} cz - Capsule centre Z.
     * @param {number} halfHeight - Half the length of the capsule segment.
     * @param {number} radius - Capsule radius.
     * @param {Vec3Like} out - Receives the deepest push.
     * @returns {boolean} True when a penetration was found.
     */
    #resolveDeepestPenetrationCapsule(cx, cy, cz, halfHeight, radius, out) {
        const voxelSize = this.voxelSize;
        const radiusSq = radius * radius;
        const segBottomY = cy - halfHeight;
        const segTopY = cy + halfHeight;
        const ixMin = Math.floor((cx - radius - this.gridMinX) / voxelSize);
        const iyMin = Math.floor((segBottomY - radius - this.gridMinY) / voxelSize);
        const izMin = Math.floor((cz - radius - this.gridMinZ) / voxelSize);
        const ixMax = Math.floor((cx + radius - this.gridMinX) / voxelSize);
        const iyMax = Math.floor((segTopY + radius - this.gridMinY) / voxelSize);
        const izMax = Math.floor((cz + radius - this.gridMinZ) / voxelSize);
        let bestPushX = 0;
        let bestPushY = 0;
        let bestPushZ = 0;
        let bestPen = PENETRATION_EPSILON;
        let found = false;

        for (let iz = izMin; iz <= izMax; iz++) {
            for (let iy = iyMin; iy <= iyMax; iy++) {
                for (let ix = ixMin; ix <= ixMax; ix++) {
                    if (!this.isVoxelSolid(ix, iy, iz)) {
                        continue;
                    }
                    const vMinX = this.gridMinX + ix * voxelSize;
                    const vMinY = this.gridMinY + iy * voxelSize;
                    const vMinZ = this.gridMinZ + iz * voxelSize;
                    const vMaxX = vMinX + voxelSize;
                    const vMaxY = vMinY + voxelSize;
                    const vMaxZ = vMinZ + voxelSize;
                    let segY;
                    if (segTopY < vMinY) {
                        segY = segTopY;
                    } else if (segBottomY > vMaxY) {
                        segY = segBottomY;
                    } else {
                        segY = Math.max(segBottomY, Math.min(segTopY, (vMinY + vMaxY) * 0.5));
                    }
                    const nearX = Math.max(vMinX, Math.min(cx, vMaxX));
                    const nearY = Math.max(vMinY, Math.min(segY, vMaxY));
                    const nearZ = Math.max(vMinZ, Math.min(cz, vMaxZ));
                    const dx = cx - nearX;
                    const dy = segY - nearY;
                    const dz = cz - nearZ;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    if (distSq >= radiusSq) {
                        continue;
                    }
                    let px = 0;
                    let py = 0;
                    let pz = 0;
                    let penetration;
                    if (distSq > 1e-12) {
                        const dist = Math.sqrt(distSq);
                        penetration = radius - dist;
                        const invDist = 1 / dist;
                        px = dx * invDist * penetration;
                        py = dy * invDist * penetration;
                        pz = dz * invDist * penetration;
                    } else {
                        // Centre exactly inside the voxel: pick the cheapest axis to escape on.
                        const escapeX = Math.min(cx - vMinX, vMaxX - cx) + radius;
                        const escapeY = Math.min(segY - vMinY, vMaxY - segY) + radius;
                        const escapeZ = Math.min(cz - vMinZ, vMaxZ - cz) + radius;
                        if (escapeX <= escapeY && escapeX <= escapeZ) {
                            px = cx - vMinX < vMaxX - cx ? -escapeX : escapeX;
                            penetration = escapeX;
                        } else if (escapeY <= escapeZ) {
                            py = segY - vMinY < vMaxY - segY ? -escapeY : escapeY;
                            penetration = escapeY;
                        } else {
                            pz = cz - vMinZ < vMaxZ - cz ? -escapeZ : escapeZ;
                            penetration = escapeZ;
                        }
                    }
                    if (penetration > bestPen) {
                        bestPen = penetration;
                        bestPushX = px;
                        bestPushY = py;
                        bestPushZ = pz;
                        found = true;
                    }
                }
            }
        }
        if (found) {
            out.x = bestPushX;
            out.y = bestPushY;
            out.z = bestPushZ;
        }
        return found;
    }

    /**
     * Apply a few push-out passes so corner collisions do not trap the capsule.
     *
     * Each pass records the contact normal and projects later pushes off the
     * normals already collected, which is what stops two walls from cancelling
     * each other out in a corner.
     *
     * @param {number} cx - Capsule centre X.
     * @param {number} cy - Capsule centre Y.
     * @param {number} cz - Capsule centre Z.
     * @param {(x: number, y: number, z: number, out: Vec3Like) => boolean} findPenetration
     *        Penetration probe for one pass.
     * @param {Vec3Like} out - Receives the accumulated push.
     * @returns {boolean} True when the accumulated push is significant.
     */
    #resolveIterative(cx, cy, cz, findPenetration, out) {
        let resolvedX = cx;
        let resolvedY = cy;
        let resolvedZ = cz;
        let totalPushX = 0;
        let totalPushY = 0;
        let totalPushZ = 0;
        let hadCollision = false;
        let numNormals = 0;

        for (let iter = 0; iter < MAX_RESOLVE_ITERATIONS; iter++) {
            if (!findPenetration(resolvedX, resolvedY, resolvedZ, this.#scratchPush)) {
                break;
            }
            hadCollision = true;
            let px = this.#scratchPush.x;
            let py = this.#scratchPush.y;
            let pz = this.#scratchPush.z;

            for (let i = 0; i < numNormals; i++) {
                const n = this.#contactNormals[i];
                const dot = px * n.x + py * n.y + pz * n.z;
                if (dot < 0) {
                    px -= dot * n.x;
                    py -= dot * n.y;
                    pz -= dot * n.z;
                }
            }

            const len = Math.sqrt(
                this.#scratchPush.x * this.#scratchPush.x +
                    this.#scratchPush.y * this.#scratchPush.y +
                    this.#scratchPush.z * this.#scratchPush.z
            );
            if (len > PENETRATION_EPSILON && numNormals < 3) {
                const invLen = 1 / len;
                const n = this.#contactNormals[numNormals];
                n.x = this.#scratchPush.x * invLen;
                n.y = this.#scratchPush.y * invLen;
                n.z = this.#scratchPush.z * invLen;
                numNormals++;
            }

            resolvedX += px;
            resolvedY += py;
            resolvedZ += pz;
            totalPushX += px;
            totalPushY += py;
            totalPushZ += pz;
        }

        const totalPushSq = totalPushX * totalPushX + totalPushY * totalPushY + totalPushZ * totalPushZ;
        const hasSignificantPush = hadCollision && totalPushSq > PENETRATION_EPSILON * PENETRATION_EPSILON;
        if (hasSignificantPush) {
            out.x = totalPushX;
            out.y = totalPushY;
            out.z = totalPushZ;
        }
        return hasSignificantPush;
    }
}
