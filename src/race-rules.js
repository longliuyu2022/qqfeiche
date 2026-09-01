export const DIFFICULTY_RULES = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    label: '简单',
    shortLabel: '简单模式',
    rewardMultiplier: 1,
  }),
  hard: Object.freeze({
    id: 'hard',
    label: '困难',
    shortLabel: '困难模式',
    rewardMultiplier: 1.25,
  }),
});

export const TRACK_VARIANTS = Object.freeze({
  normal: Object.freeze({ id: 'normal', label: '正向', reverse: false, mirror: false }),
  reverse: Object.freeze({ id: 'reverse', label: '反向', reverse: true, mirror: false }),
  mirror: Object.freeze({ id: 'mirror', label: '镜像', reverse: false, mirror: true }),
});

export function normalizeDifficulty(value) {
  return DIFFICULTY_RULES[value]?.id ?? 'easy';
}

export function difficultyRule(value) {
  return DIFFICULTY_RULES[normalizeDifficulty(value)];
}

export function normalizeTrackVariant(value) {
  return TRACK_VARIANTS[value]?.id ?? 'normal';
}

export function trackVariantRule(value) {
  return TRACK_VARIANTS[normalizeTrackVariant(value)];
}

