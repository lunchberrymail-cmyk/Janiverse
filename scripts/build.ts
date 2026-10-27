// Bundle local screenshots, short walkthrough recordings and licensed fonts for offline use.
const result = await Bun.build({
  entrypoints: ['src/frontend.ts', 'src/backend.ts'], target: 'browser', outdir: 'dist', minify: true,
  plugins: [{ name: 'bundled-assets', setup(build) {
    build.onLoad({ filter: /\.(png|woff2|webm)$/ }, async ({ path }) => ({
      contents: `export default ${JSON.stringify(`data:${path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.webm') ? 'video/webm' : 'image/png'};base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')}`)};`,
      loader: 'js',
    }));
  } }],
});
if (!result.success) { console.error(result.logs); process.exit(1); }
for (const output of result.outputs) console.log(`${output.path.split(/[\\/]/).pop()} ${(output.size / 1024).toFixed(1)} KB`);
