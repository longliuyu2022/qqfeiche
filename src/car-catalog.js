// 车辆目录：数组顺序即车库展示顺序。
// stats 为车库星条展示用的 1–5 整数；physics 为作用在 ArcadeVehicle
// 基准配置上的乘数（1 = 基准值），由 applyCarPhysics 应用。

export const CAR_CATALOG = [
  {
    id: 'volt',
    name: '幻影 Volt',
    carClass: 'A',
    flavor: '均衡调校的全能座驾，任何赛道都能稳定发挥。',
    color: '#ff3b30',
    accentColor: '#2ce8f5',
    stats: { topSpeed: 3, acceleration: 3, handling: 3, nitroPower: 3, charge: 3 },
    physics: {
      maxSpeed: 1,
      acceleration: 1,
      steeringRate: 1,
      normalGrip: 1,
      nitroAcceleration: 1,
      nitroDrainRate: 1,
      driftNitroRate: 1,
      miniBoostAcceleration: 1,
      miniBoostDuration: 1,
      collisionMass: 1,
    },
  },
  {
    id: 'raiden',
    name: '雷鸣 Raiden',
    carClass: 'S',
    flavor: '为极速而生的直线猛兽，氮气全开时无人能挡。',
    color: '#1f6bff',
    accentColor: '#9df9ff',
    stats: { topSpeed: 5, acceleration: 2, handling: 2, nitroPower: 5, charge: 2 },
    physics: {
      maxSpeed: 1.06,
      acceleration: 0.97,
      steeringRate: 1,
      normalGrip: 0.96,
      nitroAcceleration: 1.12,
      nitroDrainRate: 1.06,
      driftNitroRate: 0.92,
      miniBoostAcceleration: 1,
      miniBoostDuration: 1,
      collisionMass: 0.88,
    },
  },
  {
    id: 'nimbus',
    name: '云雀 Nimbus',
    carClass: 'A',
    flavor: '漂移集气效率冠军，弯道就是它的充电站。',
    color: '#2fe0b8',
    accentColor: '#f2fbff',
    stats: { topSpeed: 2, acceleration: 3, handling: 4, nitroPower: 3, charge: 5 },
    physics: {
      maxSpeed: 0.97,
      acceleration: 1,
      steeringRate: 1.05,
      normalGrip: 1,
      nitroAcceleration: 1,
      nitroDrainRate: 1,
      driftNitroRate: 1.22,
      miniBoostAcceleration: 1.08,
      miniBoostDuration: 1.06,
      collisionMass: 0.92,
    },
  },
  {
    id: 'goliath',
    name: '磐石 Goliath',
    carClass: 'B',
    flavor: '宽体重装的抓地怪兽，再乱的车阵也撞不乱它的走线。',
    color: '#ff9f1c',
    accentColor: '#ffd166',
    stats: { topSpeed: 1, acceleration: 4, handling: 4, nitroPower: 3, charge: 3 },
    physics: {
      maxSpeed: 0.94,
      acceleration: 1.05,
      steeringRate: 0.94,
      normalGrip: 1.15,
      nitroAcceleration: 1.04,
      nitroDrainRate: 1,
      driftNitroRate: 1,
      miniBoostAcceleration: 1,
      miniBoostDuration: 1,
      collisionMass: 1.22,
    },
  },
];

export const DEFAULT_CAR_ID = 'volt';

export function getCarById(id) {
  return CAR_CATALOG.find((car) => car.id === id)
    ?? CAR_CATALOG.find((car) => car.id === DEFAULT_CAR_ID)
    ?? CAR_CATALOG[0];
}

export function applyCarPhysics(baseConfig, car) {
  const config = { ...baseConfig };
  for (const [key, multiplier] of Object.entries(car?.physics ?? {})) {
    if (typeof baseConfig[key] !== 'number') continue;
    config[key] = baseConfig[key] * multiplier;
  }
  return config;
}
