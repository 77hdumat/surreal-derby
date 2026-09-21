#!/usr/bin/env node
/**
 * Sketchfab glTF 폴더 → 웹용 단일 GLB.
 *   node scripts/optimize-model.mjs <name> [maxTexture=1024] [--drop=<node-name-regex>]
 * public/models/<name>/scene.gltf → public/models/<name>.glb, 원본 폴더 삭제.
 * 텍스처: 최대 해상도 제한 + WebP, 애니메이션 리샘플, 미사용 데이터 정리.
 * 뼈·클립 이름과 계층은 그대로 보존한다 (리그 매핑용).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, metalRough, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [name, maxArg, ...rest] = process.argv.slice(2);
if (!name) {
  console.error('usage: optimize-model.mjs <name> [maxTexture] [--drop=regex]');
  process.exit(1);
}
const maxTex = Number(maxArg) || 1024;
const drop = rest.find((a) => a.startsWith('--drop='))?.slice(7);
const ratioArg = rest.find((a) => a.startsWith('--simplify='))?.slice(11);
const ratio = ratioArg ? Number(ratioArg) : 0;
const root = join(process.cwd(), 'public', 'models');
const src = join(root, name, 'scene.gltf');
const out = join(root, `${name}.glb`);
if (!existsSync(src)) {
  console.error('없음:', src);
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
if (drop) {
  const re = new RegExp(drop);
  for (const node of doc.getRoot().listNodes()) {
    if (re.test(node.getName()) && node.getMesh()) {
      console.log('drop mesh on node', node.getName());
      node.setMesh(null);
    }
  }
}
if (ratio > 0 && ratio < 1) await MeshoptSimplifier.ready;
await doc.transform(
  metalRough(), // KHR_materials_pbrSpecularGlossiness → metal/rough (three 미지원 확장)
  dedup(),
  prune(),
  resample(),
  ...(ratio > 0 && ratio < 1 ? [weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 })] : []),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex], quality: 82 }),
);
await io.write(out, doc);
const bones = doc.getRoot().listNodes().length;
const clips = doc.getRoot().listAnimations().map((a) => a.getName());
console.log(`${name}.glb 작성 — nodes ${bones}, clips: ${clips.join(', ')}`);
rmSync(join(root, name), { recursive: true, force: true });
