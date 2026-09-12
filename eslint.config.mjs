import js from '@eslint/js';
import globals from 'globals';

// 这份配置的目标是「挡住手误型错误」，不是统一代码风格。
//
// 项目 22k 行 JS 一直靠测试和人眼兜，加 lint 的价值在于自动发现拼错的变量名、
// 用了未定义的标识符、写了永远不会执行的分支这类问题。缩进、引号、分号这些
// 风格项一律不管：既有代码风格本来就统一，硬加规则只会产出大量无意义 diff，
// 把真正的告警埋掉。
export default [
  {
    // 构建产物、依赖、Android 打包目录都不是源码。
    ignores: [
      'dist/**',
      'node_modules/**',
      'android/**',
      '.android-sdk/**',
      '.gradle-dist/**',
      'artifacts/**',
    ],
  },
  js.configs.recommended,
  {
    // 浏览器侧源码：src/ 下全部模块，外加入口 HTML 里引用的脚本。
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // 运行时通过 window 传参的调试与自动化钩子（见 bootstrap.js / main.js）。
        __NEON_APEX__: 'writable',
      },
    },
    rules: {
      // 未使用的变量通常是重构留下的残渣，但函数参数经常为了签名对齐而保留，
      // 所以只查变量，参数放过。以 _ 开头的显式声明「我知道它没用」。
      'no-unused-vars': ['error', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 生产代码里不该留 console，但 warn/error 是有意的诊断输出。
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // 下面几条都是「几乎肯定是 bug」的形态。
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // == 在这个项目里没有正当用途，null 比较用 ?? 或显式判断。
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // 服务端与测试跑在 Node 上，全局对象完全不同。
    //
    // 测试文件同时需要浏览器全局：浏览器回归用 page.evaluate(() => window...)
    // 把回调序列化后送进页面里执行，那些 window / document 引用在浏览器上下文
    // 里是合法的，只是源码文本待在一个 Node 文件里。ESLint 无法区分这两层作用域，
    // 所以两套全局都给上——否则会报出 234 个假告警，把真问题埋掉。
    files: ['server/**/*.mjs', 'tests/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 服务端日志和测试输出都靠 console，这里不该报。
      'no-console': 'off',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
];
