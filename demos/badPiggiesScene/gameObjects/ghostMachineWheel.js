import { MachineWheel } from './machineWheel.js';

/** Cursor preview only — not included in save games. */
export class GhostMachineWheel extends MachineWheel {
  static serializable = false;
  static scriptUrl = import.meta.url;
  static instances = [];
}
