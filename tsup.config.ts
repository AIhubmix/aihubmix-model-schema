import { defineConfig } from 'tsup';

// 与 @aihubmix/codegen 同一套产物形态（ESM + CJS + d.ts + d.cts）：两端消费者一个是
// Vite/ESM、一个是 CRA + Node 预渲染脚本（CommonJS），少一份就有一端接不上。
//
// codegen 是 external（不打进产物）：它是 dependencies，必须由使用方装同一份实例，
// 打进来会出现两份 buildBody —— 「Get Code 与真实请求同源」就断了。
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  sourcemap: true,
  treeshake: true,
  external: ['@aihubmix/codegen'],
});
