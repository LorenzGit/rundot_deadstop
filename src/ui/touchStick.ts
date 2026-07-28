export interface TouchStickVector {
    x: number;
    y: number;
    knobX: number;
    knobY: number;
}

export function floatingStickVector(
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    maxDistance: number,
    deadzone: number,
): TouchStickVector {
    const dx = pointerX - originX;
    const dy = pointerY - originY;
    const distance = Math.hypot(dx, dy);
    if (distance <= deadzone || maxDistance <= deadzone) {
        return { x: 0, y: 0, knobX: 0, knobY: 0 };
    }

    const knobDistance = Math.min(distance, maxDistance);
    const directionX = dx / distance;
    const directionY = dy / distance;
    const strength = Math.min(1, (distance - deadzone) / (maxDistance - deadzone));
    return {
        x: directionX * strength,
        y: directionY * strength,
        knobX: directionX * knobDistance,
        knobY: directionY * knobDistance,
    };
}
