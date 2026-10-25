// Inline local tutorial screenshots so the extension remains two standalone bundles.
const result = await Bun.build({
  entrypoints: ['src/frontend.ts', 'src/backend.ts'], target: 'browser', outdir: 'dist', minify: true,
  plugins: [{ name: 'tutorial-screenshots', setup(build) {
    build.onLoad({ filter: /\.png$/ }, async ({ path }) => ({
      contents: `export default ${JSON.stringify(`data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')}`)};`,
      loader: 'js',
    }));
  } }],
});
if (!result.success) { console.error(result.logs); process.exit(1); }
for (const output of result.outputs) console.log(`${output.path.split(/[\\/]/).pop()} ${(output.size / 1024).toFixed(1)} KB`);
