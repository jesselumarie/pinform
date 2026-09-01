export const PIN_LENGTH = 0.86;
export const MIN_PIN_TRAVEL = -0.28;
export const MAX_PIN_TRAVEL = 1.15;
export const IMPRINT_SCALE = 1;

export function clampPinTravel(travel: number) {
  return Math.min(MAX_PIN_TRAVEL, Math.max(MIN_PIN_TRAVEL, travel));
}

export function anchoredPinOffset(localZ: number, travel: number) {
  const anchor = Math.min(1, Math.max(0, (localZ + PIN_LENGTH / 2) / PIN_LENGTH));
  return clampPinTravel(travel) * anchor;
}

export function mapImprintCoordinate(coordinate: number) {
  return (coordinate - 0.5) / IMPRINT_SCALE + 0.5;
}
