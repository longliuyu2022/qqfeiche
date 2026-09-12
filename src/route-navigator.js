const TAU = Math.PI * 2;

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function signedHeadingDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= TAU;
  while (delta < -Math.PI) delta += TAU;
  return delta;
}

function headingOf(tangent) {
  return Math.atan2(tangent.x, tangent.z);
}

export function turnDirection(angle) {
  // With +Z forward, the driver's screen-right vector is tangent x up (-X).
  return angle > 0 ? 'left' : 'right';
}

function classify(angle) {
  const magnitude = Math.abs(angle);
  if (magnitude >= 1.02) return 'hairpin';
  if (magnitude >= 0.58) return 'sharp';
  return 'medium';
}

function labelFor(direction, severity) {
  const side = direction === 'left' ? '左' : '右';
  if (severity === 'hairpin') return `${side}回头弯`;
  if (severity === 'sharp') return `${side}急弯`;
  return `${side}弯`;
}

export function createRouteNavigator(curve, options = {}) {
  if (!curve?.getTangentAt || !curve?.getLength) throw new Error('Route navigator requires a track curve.');
  const trackLength = Math.max(1, curve.getLength());
  const scanStepMeters = Math.max(8, options.scanStepMeters ?? 18);
  const turnWindowMeters = Math.max(28, options.turnWindowMeters ?? 54);
  const maxLookAheadMeters = Math.max(100, options.maxLookAheadMeters ?? 320);
  const minimumAngle = options.minimumAngle ?? 0.2;
  const stepProgress = scanStepMeters / trackLength;
  const windowProgress = turnWindowMeters / trackLength;
  const scanCount = Math.ceil(maxLookAheadMeters / scanStepMeters);

  function angleAt(progress) {
    const before = curve.getTangentAt(wrap01(progress - windowProgress * 0.5));
    const after = curve.getTangentAt(wrap01(progress + windowProgress * 0.5));
    return signedHeadingDelta(headingOf(before), headingOf(after));
  }

  function findTurn(progress, startIndex = 1) {
    for (let index = startIndex; index <= scanCount; index += 1) {
      const probe = wrap01(progress + stepProgress * index);
      const angle = angleAt(probe);
      if (Math.abs(angle) < minimumAngle) continue;
      let peakAngle = angle;
      let peakIndex = index;
      for (let run = 1; run <= 3; run += 1) {
        const nextAngle = angleAt(wrap01(probe + stepProgress * run));
        if (Math.sign(nextAngle) !== Math.sign(angle) || Math.abs(nextAngle) < minimumAngle * 0.72) break;
        if (Math.abs(nextAngle) > Math.abs(peakAngle)) {
          peakAngle = nextAngle;
          peakIndex = index + run;
        }
      }
      const direction = turnDirection(peakAngle);
      const severity = classify(peakAngle);
      return {
        progress: wrap01(progress + stepProgress * peakIndex),
        distance: Math.round(peakIndex * scanStepMeters),
        direction,
        severity,
        angle: peakAngle,
        label: labelFor(direction, severity),
        scanIndex: peakIndex,
      };
    }
    return null;
  }

  function getCue(progress) {
    const primary = findTurn(wrap01(progress));
    if (!primary) return { primary: null, secondary: null, trackLength };
    const secondary = findTurn(wrap01(progress), primary.scanIndex + 4);
    return {
      primary,
      secondary: secondary && secondary.direction !== primary.direction
        ? { ...secondary, label: `随后${secondary.direction === 'left' ? '左' : '右'}` }
        : null,
      trackLength,
    };
  }

  return Object.freeze({ trackLength, getCue });
}
