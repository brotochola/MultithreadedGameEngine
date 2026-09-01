import { MachineRocket } from './machineRocket.js';

/** Cursor preview only — not included in save games. */
export class GhostMachineRocket extends MachineRocket {
  static serializable = false;
  static scriptUrl = import.meta.url;
  static instances = [];
}
