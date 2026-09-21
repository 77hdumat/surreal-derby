#!/usr/bin/env node
/** GLB/glTF 노드·메쉬·바운딩 박스 요약: node scripts/inspect-scene.mjs <path> */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
const bounds = getBounds;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const b = bounds(scene);
console.log('scene bbox min', b.min.map((v) => v.toFixed(2)), 'max', b.max.map((v) => v.toFixed(2)));
const walk = (n, d) => {
  const mesh = n.getMesh();
  if (mesh) {
    const nb = bounds(n);
    const tris = mesh.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3), 0);
    console.log(`${'  '.repeat(d)}${n.getName()} [${mesh.getName()}] tris=${Math.round(tris)} bbox=(${nb.min.map((v) => v.toFixed(1))})..(${nb.max.map((v) => v.toFixed(1))}) mats=${mesh.listPrimitives().map((p) => p.getMaterial()?.getName()).join(',')}`);
  }
  for (const c of n.listChildren()) walk(c, d + 1);
};
for (const n of scene.listChildren()) walk(n, 0);
console.log('textures:', root.listTextures().map((t) => `${t.getName() || t.getURI()} ${t.getSize()?.join('x')}`).join(' | '));
