#!/usr/bin/env node
/**
 * 정적(비리깅) 씬 모델 최적화: node scripts/optimize-scene.mjs <name> [maxTexture=1024] [simplifyRatio]
 * public/models/<name>/scene.gltf → public/models/<name>.glb (텍스처 WebP, 선택적 메쉬 단순화)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, simplify, weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [name, maxArg, ratioArg, ...rest] = process.argv.slice(2);
const maxTex = Number(maxArg) || 1024;
const ratio = ratioArg ? Number(ratioArg) : 0;
const drop = rest.find((a) => a.startsWith('--drop='))?.slice(7);
const root = join(process.cwd(), 'public', 'models');
const src = join(root, name, 'scene.gltf');
const out = join(root, `${name}.glb`);
if (!existsSync(src)) {
  console.error('없음:', src);
  process.exit(1);
}
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
if (drop) {
  const re = new RegExp(drop);
  for (const node of doc.getRoot().listNodes()) {
    if (re.test(node.getName()) && node.getMesh()) {
      console.log('drop', node.getName());
      node.setMesh(null);
    }
  }
}
const ops = [dedup(), prune()];
if (ratio > 0 && ratio < 1) {
  await MeshoptSimplifier.ready;
  ops.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }));
}
ops.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex], quality: 80 }));
// 지오메트리 양자화 + meshopt 압축 (three: MeshoptDecoder 필요)
await MeshoptEncoder.ready;
ops.push(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...ops);
await io.write(out, doc);
console.log(`${name}.glb → ${(statSync(out).size / 1e6).toFixed(2)} MB`);
rmSync(join(root, name), { recursive: true, force: true });
