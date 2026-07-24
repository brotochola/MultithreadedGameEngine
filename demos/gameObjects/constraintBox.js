// ConstraintBox - Square rigid body via 4 corner + 1 center circle parts + distance constraints
// Visual parent syncs position/rotation from corner centroid and edge angle

import WEED from '/src/index.js';
import {
    ConstraintBoxComponent,
    CONSTRAINT_BOX_DEFAULTS,
    PART_KEYS,
    CONSTRAINT_KEYS,
} from '../components/constraintBoxComponent.js';
import { BoxPart } from './boxPart.js';

const { GameObject, SpriteRenderer, Transform, Constraint, RigidBody } = WEED;

// Part layout (row-major corners + center):
// 0 -- 1
// | \/ |
// | 4  |
// | /\ |
// 2 -- 3
const EDGE_PAIRS = [
    [0, 1], [1, 3], [3, 2], [2, 0], // sides
    [0, 3], [1, 2],                 // diagonals
    [4, 0], [4, 1], [4, 2], [4, 3], // center spokes
];

export class ConstraintBox extends GameObject {
    static scriptUrl = import.meta.url;

    static components = [SpriteRenderer, ConstraintBoxComponent];

    setup() {
        this.spriteRenderer.anchorX = 0.5;
        this.spriteRenderer.anchorY = 0.5;
    }

    onSpawned(spawnConfig = {}) {
        const x = spawnConfig.x || 0;
        const y = spawnConfig.y || 0;
        const size = spawnConfig.size ?? CONSTRAINT_BOX_DEFAULTS.size;
        const stiffness = spawnConfig.stiffness
            ?? spawnConfig.constraintStiffness
            ?? CONSTRAINT_BOX_DEFAULTS.constraintStiffness;
        const angularDamping = spawnConfig.angularDamping
            ?? CONSTRAINT_BOX_DEFAULTS.angularDamping;
        const sprite = spawnConfig.sprite || 'box';

        this.constraintBoxComponent.size = size;
        this.constraintBoxComponent.constraintStiffness = stiffness;
        this.constraintBoxComponent.angularDamping = angularDamping;
        this.constraintBoxComponent.angle = 0;

        // Texture is 100x100; scale so visual matches outer size
        const texSize = 100;
        const scale = size / texSize;
        this.setSprite(sprite);
        this.setScale(scale, scale);

        // Corner radius 20% of side; centers inset so each circle touches two perpendicular sides
        const half = size * 0.5;
        const radius = size * 0.13;
        const ratioOfBiggerCircle = size * 0.475
        const inset = half - radius;
        const offsets = [
            [-inset, -inset],
            [inset, -inset],
            [-inset, inset],
            [inset, inset],
            [0, 0], // center
        ];
        const radii = [radius, radius, radius, radius, ratioOfBiggerCircle];

        const parts = [];
        // Negative groupIndex: siblings never collide; other boxes (different index) still do
        const groupIndex = -this.index;
        for (let i = 0; i < 5; i++) {
            const [ox, oy] = offsets[i];
            const part = BoxPart.spawn({
                x: x + ox,
                y: y + oy,
                radius: radii[i],
                collisionGroupIndex: groupIndex,
            });
            if (!part) {
                console.error(`ConstraintBox: Failed to spawn BoxPart ${i}`);
                for (const p of parts) p.despawn();
                return;
            }
            parts.push(part);
            this.constraintBoxComponent[PART_KEYS[i]] = part.index;
        }
        this.constraintBoxComponent.partCount = 5;

        for (let i = 0; i < EDGE_PAIRS.length; i++) {
            const [a, b] = EDGE_PAIRS[i];
            const dist = Math.hypot(
                Transform.x[parts[a].index] - Transform.x[parts[b].index],
                Transform.y[parts[a].index] - Transform.y[parts[b].index]
            );
            const idx = Constraint.add(parts[a].index, parts[b].index, dist, stiffness);
            this.constraintBoxComponent[CONSTRAINT_KEYS[i]] = idx;
        }
        this.constraintBoxComponent.constraintCount = EDGE_PAIRS.length;
    }

    onDespawned() {
        const constraintCount = this.constraintBoxComponent.constraintCount;
        const partCount = this.constraintBoxComponent.partCount;

        for (let i = 0; i < constraintCount; i++) {
            const idx = this.constraintBoxComponent[CONSTRAINT_KEYS[i]];
            if (idx >= 0) Constraint.remove(idx);
            this.constraintBoxComponent[CONSTRAINT_KEYS[i]] = -1;
        }

        for (let i = 0; i < partCount; i++) {
            const partIdx = this.constraintBoxComponent[PART_KEYS[i]];
            if (partIdx > 0 && Transform.active[partIdx]) {
                const part = GameObject.get(partIdx);
                if (part) part.despawn();
            }
            this.constraintBoxComponent[PART_KEYS[i]] = 0;
        }

        this.constraintBoxComponent.partCount = 0;
        this.constraintBoxComponent.constraintCount = 0;
        this.constraintBoxComponent.angle = 0;
    }

    tick(dtRatio) {
        const partCount = this.constraintBoxComponent.partCount;
        if (partCount < 5) return;

        const indices = [];
        for (let i = 0; i < 4; i++) {
            const idx = this.constraintBoxComponent[PART_KEYS[i]];
            if (!(idx > 0 && Transform.active[idx])) return;
            indices.push(idx);
        }

        const centerIdx = this.constraintBoxComponent.part4Index;
        if (!(centerIdx > 0 && Transform.active[centerIdx])) return;

        const [p0, p1, p2, p3] = indices;

        const centerX = (Transform.x[p0] + Transform.x[p1] + Transform.x[p2] + Transform.x[p3]) * 0.25;
        const centerY = (Transform.y[p0] + Transform.y[p1] + Transform.y[p2] + Transform.y[p3]) * 0.25;
        Transform.x[this.index] = centerX;
        Transform.y[this.index] = centerY;

        // Left edge midpoint (0,2) → right edge midpoint (1,3)
        const leftX = (Transform.x[p0] + Transform.x[p2]) * 0.5;
        const leftY = (Transform.y[p0] + Transform.y[p2]) * 0.5;
        const rightX = (Transform.x[p1] + Transform.x[p3]) * 0.5;
        const rightY = (Transform.y[p1] + Transform.y[p3]) * 0.5;

        const angle = Math.atan2(rightY - leftY, rightX - leftX);
        this.constraintBoxComponent.angle = angle;
        this.rotation = angle;

        // Soft-body angular damping: strip tangential velocity around centroid
        const damp = this.constraintBoxComponent.angularDamping;
        if (damp > 0) {
            const t = Math.min(1, damp * dtRatio);
            for (let i = 0; i < 5; i++) {
                const idx = this.constraintBoxComponent[PART_KEYS[i]];
                const rx = Transform.x[idx] - centerX;
                const ry = Transform.y[idx] - centerY;
                const r2 = rx * rx + ry * ry;
                if (r2 < 1e-6) continue;
                const vx = RigidBody.vx[idx];
                const vy = RigidBody.vy[idx];
                const cross = rx * vy - ry * vx;
                RigidBody.vx[idx] = vx + (ry * cross / r2) * t;
                RigidBody.vy[idx] = vy - (rx * cross / r2) * t;
            }
        }
    }
}
