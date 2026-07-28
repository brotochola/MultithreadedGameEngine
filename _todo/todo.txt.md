Since Box2d:
- [x] clean up dead code (collisionData / SAT / legacy logic path)
- [x] zero-copy hot pose/vel (HEAP rebind) — verified, not rebuilt
- [x] hot-path GC (hoist drainCommands handlers + contact applyBegin/End)
- [x] update tests
- [x] keep polyVertexX/Y (Ray + Box2D polygon create + debug)

- shader de lightOccluders q use el sprite para mask.
- lightoccluder rectangluar

- static props en components?

---

---

## -- spritesheet registry ---

---

## hot reload

JSDoc `@typedef`,

---

7-poolsize variable, automatico.. no tener limite para la cantidad de gameobjects de tipo tal

---

-map maker: agregar pasto y faroles, y autos, y tachos de basura

---

## Lighting:

---

## Debugger:

---

## QUERY SYSTEM:

---

## FSM

---

## GAME ENGINE:

- TWEENS - GSAP

-generar mas chaboncitos

---

      GAME OBJECTS:

---

-getAllPropertiesFromAllComponents(): para asi poder clonar
-this.constructor.spawnCloneFromInstance(this)
-this.constructor.spawnCloneFromEntity(this.index)

---

---

-eventEmitter
-tags: se crean los tags, se le pone uno o mas tags a las entidades,

---

## -- sonido ---

---

## --- SPATIAL WORKER: ---

---

## --- NAV WORKER: ---

---

## --- LOGIC WORKERs: ---

---

## --- PHYSICS WORKER: ---

---

## --- PIXI-WORKER: ---

---

## ---- Particle Worker

bouncing/sliding !

---

## --- GAME OBJECT
