import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const name of process.argv.slice(2)) {
  const doc = await io.read(`public/models/${name}.glb`);
  const root = doc.getRoot();
  console.log(`=== ${name}`);
  const scene = root.listScenes()[0];
  const walk = (n, d) => {
    const m = n.getWorldMatrix();
    const mesh = n.getMesh();
    const skin = n.getSkin();
    console.log(`${'  '.repeat(d)}${n.getName()} (${m[12].toFixed(2)}, ${m[13].toFixed(2)}, ${m[14].toFixed(2)})${mesh ? ' [mesh ' + mesh.getName() + ']' : ''}${skin ? ' [skin]' : ''}`);
    for (const c of n.listChildren()) walk(c, d + 1);
  };
  for (const n of scene.listChildren()) walk(n, 0);
  for (const a of root.listAnimations()) {
    const ch = a.listChannels();
    const dur = Math.max(...a.listSamplers().map((s) => { const t = s.getInput(); return t ? t.getMax([0])[0] : 0; }));
    console.log(`clip ${a.getName()} dur=${dur.toFixed(2)} channels=${ch.length}`);
  }
}
