// OrientedBox - Rigid crate as Box2D-style 4-vert Polygon (makeBox)

import WEED from '/src/index.js';

const { GameObject, RigidBody, Collider, SpriteRenderer } = WEED;

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

        Collider.makeBox(this.index, width * 0.5, height * 0.5);
        this.collider.isTrigger = 0;
        this.collider.contactFriction = 1;
        this.collider.visualRange = Math.hypot(width, height) * 0.5 + 200;

        this.rigidBody.static = 0;
        this.rigidBody.maxVel = 150000;
        this.rigidBody.minSpeed = 0;
        this.rigidBody.friction = 0.001;
        this.rigidBody.angularDrag = 0.01;
        this.rigidBody.angularVelocity = 0;
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
