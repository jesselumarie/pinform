export interface Rotation {
  x: number;
  y: number;
}

const MAX_PITCH = 0.58;
const MAX_YAW = 0.82;
const DRAG_SCALE = 0.004;

export function applyDragRotation(rotation: Rotation, deltaX: number, deltaY: number): Rotation {
  return {
    x: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, rotation.x + deltaY * DRAG_SCALE)),
    y: Math.max(-MAX_YAW, Math.min(MAX_YAW, rotation.y + deltaX * DRAG_SCALE)),
  };
}

export function settleRotation(current: Rotation, target: Rotation, damping: number): Rotation {
  return {
    x: current.x + (target.x - current.x) * damping,
    y: current.y + (target.y - current.y) * damping,
  };
}
