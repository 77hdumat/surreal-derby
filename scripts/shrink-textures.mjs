#!/usr/bin/env node
/** GLB 텍스처 해상도 축소: node scripts/shrink-textures.mjs <name> <max> */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { join } from 'node:path';
import { statSync } from 'node:fs';
const [name, maxArg] = process.argv.slice(2);
const max = Number(maxArg) || 1024;
const file = join(process.cwd(), 'public', 'models', `${name}.glb`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [max, max], quality: 80 }));
await io.write(file, doc);
console.log(`${name}.glb → ${(statSync(file).size / 1e6).toFixed(2)} MB (max ${max})`);
