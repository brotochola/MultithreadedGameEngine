// CivilianBehaviorFSM.js - FSM component for civilian behavior
// States: IDLE (do nothing) and FLEEING (run away from predators)

import WEED from '/src/index.js';

import { Player } from '../gameObjects/player.js';
import { MySoldier } from '../gameObjects/mySoldier.js';
import { CivilianComponent } from '../components/civilianComponent.js';

const { FSM, FSMState, Transform, RigidBody } = WEED;

// ==========================================
// IDLE STATE - Do nothing, watch for predators
// ==========================================

class IdleCivilianBehaviorState extends FSMState {
  static onEnter(owner, i, fromState) { }

  static onUpdate(owner, i, dt) {
    // Check if any neighbor is a predator
    const playerEntityType = Player.entityType;
    const mySoldierEntityType = MySoldier.entityType;
    const neighborCount = owner.neighborCount;

    for (let n = 0; n < neighborCount; n++) {
      const neighborIndex = owner.getNeighbor(n);
      const neighBorEntityType = Transform.entityType[neighborIndex];
      if (neighBorEntityType === playerEntityType || neighBorEntityType === mySoldierEntityType) {
        // Player or my soldier detected! Flee!
        this.fsm.changeState(i, this.fsm.states.FLEEING);
        return;
      }
    }
    // owner.updateTeamData();
    // owner.groupWithMyTeam();
  }
}

// ==========================================
// FLEEING STATE - Run away from predators
// ==========================================

class FleeingCivilianBehaviorState extends FSMState {
  static onEnter(owner, i, fromState) {
    // Will set run animation in onUpdate based on direction
    RigidBody.sleeping[i] = 0;
  }

  static onUpdate(owner, i, dt) {
    const playerEntityType = Player.entityType;

    const mySoldierEntityType = MySoldier.entityType;
    const neighborCount = owner.neighborCount;

    // Accumulate flee direction from all visible predators
    let fleeX = 0;
    let fleeY = 0;
    let predatorCount = 0;

    const myX = Transform.x[i];
    const myY = Transform.y[i];

    for (let n = 0; n < neighborCount; n++) {
      const neighborIndex = owner.getNeighbor(n);

      const neighBorEntityType = Transform.entityType[neighborIndex];
      if (neighBorEntityType === playerEntityType || neighBorEntityType === mySoldierEntityType) {
        // Calculate direction away from predator
        const dx = myX - Transform.x[neighborIndex];
        const dy = myY - Transform.y[neighborIndex];
        const dist2 = dx * dx + dy * dy;

        // Guard: dist2 must be > 1 to avoid division producing Infinity
        if (dist2 > 1) {
          // Inverse square for panic effect (closer = stronger flee)
          fleeX += dx / dist2;
          fleeY += dy / dist2;
          predatorCount++;
        }
      }
    }

    // If no predators visible, return to idle
    if (predatorCount === 0) {
      this.fsm.changeState(i, this.fsm.states.IDLE);
      return;
    }

    // Same 1/r² accel as MySoldier.chaseStrength (72000) — literal avoids init cycle
    const fleeFactor = 72000;
    owner.addAcceleration(fleeX * fleeFactor, fleeY * fleeFactor);
  }

  static onExit(owner, i, toState) {
    // Could play relief sound, slow down animation, etc.
  }
}

const PANIC_DURATION_MS = 20_000;
// Match MySoldier.chaseStrength (literal — Civilian↔MySoldier import cycle)
const PANIC_FLEE_FACTOR = 8000;

class PanicCivilianBehaviorState extends FSMState {
  static onEnter(owner, i, fromState) {
    RigidBody.sleeping[i] = 0;
  }

  static onUpdate(owner, i, dt, totalTime) {
    // 20s timer: return to IDLE unless hurt again (timer resets on damage)
    if (totalTime >= PANIC_DURATION_MS) {
      this.fsm.changeState(i, this.fsm.states.IDLE);
      return;
    }

    // Flee away from panic origin (where damage came from)
    const ox = CivilianComponent.panicOriginX[i];
    const oy = CivilianComponent.panicOriginY[i];
    const dx = owner.x - ox;
    const dy = owner.y - oy;
    const dist2 = dx * dx + dy * dy;

    if (dist2 > 1) {
      // Normalize and scale for maximum flee speed (no * dt — see FLEEING)
      const invDist = 1 / dist2;
      owner.addAcceleration(
        dx * invDist * PANIC_FLEE_FACTOR,
        dy * invDist * PANIC_FLEE_FACTOR
      );
    }
  }

  static onExit(owner, i, toState) {
  }
}

// ==========================================
// FSM COMPONENT
// ==========================================

export class CivilianBehaviorFSM extends FSM {
  static states = {
    IDLE: IdleCivilianBehaviorState,
    FLEEING: FleeingCivilianBehaviorState,
    PANIC: PanicCivilianBehaviorState,
  };

  static initial = this.states.IDLE;
}
