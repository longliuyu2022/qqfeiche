const STEPS = Object.freeze([
  { id: 'throttle', title: '起步加速', detail: '完成一次稳定起步', done: (snapshot) => snapshot.speedKph >= 30 },
  { id: 'steer', title: '掌握转向', detail: '驶过第一个弯道', done: (snapshot) => Math.abs(snapshot.roadOffset || 0) > 1.1 || Math.abs(snapshot.steering || 0) > 0.22 },
  { id: 'drift', title: '练习漂移', detail: '进入漂移并保持片刻', done: (snapshot) => snapshot.isDrifting || snapshot.driftScore > 40 },
  { id: 'nitro', title: '释放氮气', detail: '储存后使用一次氮气', done: (snapshot) => snapshot.isBoosting || snapshot.nitro < 30 },
  { id: 'finish', title: '完成训练', detail: '跑完一圈，解锁正式比赛', done: (snapshot) => snapshot.finished },
]);

export function createTrainingCoach() {
  let index = 0;
  let completed = false;
  function reset() { index = 0; completed = false; }
  function update(snapshot) {
    if (completed) return getState();
    while (index < STEPS.length && STEPS[index].done(snapshot)) index += 1;
    if (index >= STEPS.length) completed = true;
    return getState();
  }
  function getState() {
    const step = STEPS[Math.min(index, STEPS.length - 1)];
    return { index, total: STEPS.length, completed, step: { ...step } };
  }
  return Object.freeze({ reset, update, getState });
}

export const TRAINING_STEPS = STEPS;
