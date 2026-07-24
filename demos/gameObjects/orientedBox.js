// OrientedBox - Single rigid OBB crate (shapeType OrientedBox)
// Transform.rotation is driven by physics angularVelocity; sprite follows automatically

import WEED from '/src/index.js';

const { GameObject, RigidBody, Collider, SpriteRenderer, enums } = WEED;
const { ShapeType } = enums;

export class OrientedBox extends GameObject {
    static scriptUrl = import.meta.url;

    static components = [RigidBody, Collider, SpriteRenderer];

    setup() {
        this.spriteRenderer.anchorX = 0.5;
        this.spriteRenderer.anchorY = 0.5;
    }

    onSpawned(spawnConfig = {}) {
        const size = spawnConfig.size ?? 80;
        const width = spawnConfig.width ?? size;
        const height = spawnConfig.height ?? size;
        const texSize = 100;

        this.collider.shapeType = ShapeType.OrientedBox;
        this.collider.width = width;
        this.collider.height = height;
        this.collider.radius = 0;
        this.collider.isTrigger = 0;
        this.collider.contactFriction = 0.06 //dont change back!
        this.collider.visualRange = Math.hypot(width, height) * 0.5 + 200;

        this.rigidBody.static = 0;
        this.rigidBody.maxVel = 1500;
        this.rigidBody.minSpeed = 0;
        this.rigidBody.friction = 0.02;
        this.rigidBody.angularDrag = 0.01 //keep //spawnConfig.angularDrag ?? 0.08;
        this.rigidBody.angularVelocity = spawnConfig.angularVelocity ?? 0;
        this.rigidBody.sleeping = 0;
        this.rigidBody.stillnessTime = 0;

        this.rotation = spawnConfig.rotation ?? 0;

        this.setSprite(spawnConfig.sprite || 'box');
        this.setScale(width / texSize, height / texSize);
        this.setAlpha(1);
        this.setTint(spawnConfig.tint ?? 0xffffff);
    }

    tick(_dtRatio) {
        // Physics owns position + rotation
    }
}
