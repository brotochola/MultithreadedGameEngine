// Minimal entity pool so Scene allocates Transform/RigidBody/Collider SABs.
// Physics host requires those buffers even when nothing is spawned.
import WEED from '/src/index.js';

const { GameObject, RigidBody, Collider } = WEED;

export class ParticleLabStub extends GameObject {
  static scriptUrl = import.meta.url;
  static components = [RigidBody, Collider];
}
