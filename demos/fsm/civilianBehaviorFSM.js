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
          // 1/r, floored — close range can't rocket
          const floorSq = owner.constructor.accelDistFloorSq;
          const d2 = dist2 < floorSq ? floorSq : dist2;
          fleeX += dx / d2;
          fleeY += dy / d2;
          predatorCount++;
        }
      }
    }

    // If no predators visible, return to idle
    if (predatorCount === 0) {
      this.fsm.changeState(i, this.fsm.states.IDLE);
      return;
    }

    // Average over predators — sum stacked N× with dozens of soldiers and rocketed
    const fleeFactor = 40500 / predatorCount;
    owner.addAcceleration(fleeX * fleeFactor, fleeY * fleeFactor);
  }

  static onExit(owner, i, toState) {
    // Could play relief sound, slow down animation, etc.
  }
}

const PANIC_DURATION_MS = 20_000;

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
      // 1/r, floored — close range can't rocket
      const floorSq = owner.constructor.accelDistFloorSq;
      const d2 = dist2 < floorSq ? floorSq : dist2;
      const panicFleeFactor = owner.constructor.panicFleeFactor;
      owner.addAcceleration(
        (dx / d2) * panicFleeFactor,
        (dy / d2) * panicFleeFactor
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
