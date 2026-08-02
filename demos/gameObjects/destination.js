// PersonWithFSM.js - Example entity using the FSM system
// Demonstrates civilian behavior with IDLE and FLEEING states

import WEED from '/src/index.js';

import { Mouse } from '../../src/core/Mouse.js';
import { containerRadius, DecorationPool, Decoration } from '../../src/index.js';

const {
  GameObject,

  Collider,
  SpriteRenderer,
} = WEED;

export class Destination extends GameObject {
  // Auto-detected by GameEngine
  static scriptUrl = import.meta.url;
  static serializable = true;
  // Components: basic physics + rendering + our FSM
  static components = [Collider, SpriteRenderer];
  static outQueryDecorationIndices = new Uint16Array(64);
  /**
   * LIFECYCLE: Configure entity TYPE properties - runs ONCE per instance
   */
  setup() {
    // Collision/perception
    this.collider.radius = 100;
    this.collider.visualRange = 0;
    this.collider.isTrigger = 1;

    // Sprite setup
    this.spriteRenderer.anchorX = 0.5;
    this.spriteRenderer.anchorY = 0.5;
    this.x = this.config.worldWidth * 0.5;
    this.y = this.config.worldHeight * 0.5;

    this.setSprite('target');
  }

  onSpawned(spawnConfig = {}) { }

  /**
   * LIFECYCLE: Main update loop
   */
  tick(dt) {

    if (Mouse.isButton0Pressed) {
      // let countOfDecorationsHit = Decoration.queryCircle(Mouse.x, Mouse.y, 100, Destination.outQueryDecorationIndices)

      // for (let i = 0; i < countOfDecorationsHit; i++) {
      //   const index = Destination.outQueryDecorationIndices[i];
      //   Decoration.get(index).sway = 0;
      //   Decoration.get(index).rotation = 0
      //   Decoration.get(index).baseRotation = 0
      //   Decoration.get(index).swayFrequency = 0
      //   Decoration.get(index).swayAmplitude = 0
      // }

      // countOfDecorationsHit = Decoration.queryCircle(Mouse.x, Mouse.y, 50, Destination.outQueryDecorationIndices)

      // for (let i = 0; i < countOfDecorationsHit; i++) {
      //   const index = Destination.outQueryDecorationIndices[i];
      //   Decoration.get(index).sway = 1;
      //   Decoration.get(index).swayAmplitude = 1
      //   Decoration.get(index).swayFrequency = 100
      // }

      this.x = Mouse.x;
      this.y = Mouse.y;
      this.collider.radius = containerRadius(MySoldier.activeCount, 12, 1);
      const allActiveSoldiers = MySoldier.getAllActiveInstances();
      for (const soldier of allActiveSoldiers) {
        soldier.startFollowingDestination();
      }
    }
  }
}
