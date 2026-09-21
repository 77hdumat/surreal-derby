import * as THREE from 'three';
import { loft, furBumpTexture } from './Loft';

type Point = [number, number, number];

/** Closed, overlapping anatomical surfaces. All limbs share explicit joint anchors. */
export function makeRider(silks: number, helmet: number, scale = 1): THREE.Group {
  const rider = new THREE.Group();
  rider.name = 'rider';
  const fabric = new THREE.MeshStandardMaterial({ color: silks, roughness: 0.72, bumpMap: furBumpTexture(), bumpScale: 0.002 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeee9dd, roughness: 0.88 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a582, roughness: 0.62 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x211c19, roughness: 0.4 });
  const cap = new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.38 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x31404a, roughness: 0.14, metalness: 0.25, clearcoat: 1 });
  function ellipsoid(p: Point, radii: Point, mat: THREE.Material, name = '') {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    mesh.position.set(...p);
    mesh.scale.set(...radii);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rider.add(mesh);
    return mesh;
  }
  function limb(a: Point, b: Point, ra: number, rb: number, mat: THREE.Material) {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, start.distanceTo(end), 20), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    mesh.castShadow = true;
    rider.add(mesh);
    ellipsoid(a, [ra, ra, ra], mat);
    ellipsoid(b, [rb, rb, rb], mat);
  }
  // Pelvis, waist, rib cage and shoulders remain a continuous closed volume.
  const torso = new THREE.Mesh(loft([
    { p: [-0.09, 0.2, 0], r: 0.105, s: [1.35, 0.85] },
    { p: [-0.04, 0.3, 0], r: 0.12, s: [1.28, 0.85] },
    { p: [0.13, 0.43, 0], r: 0.14, s: [1.3, 0.85] },
    { p: [0.27, 0.5, 0], r: 0.13, s: [1.4, 0.8] },
    { p: [0.32, 0.52, 0], r: 0.085 },
  ], 28, 24), fabric);
  torso.castShadow = true;
  rider.add(torso);
  ellipsoid([-0.08, 0.19, 0], [0.14, 0.12, 0.18], white);
  limb([0.29, 0.5, 0], [0.37, 0.59, 0], 0.061, 0.055, skin);
  ellipsoid([0.405, 0.66, 0], [0.115, 0.14, 0.103], skin, 'rider_head');
  ellipsoid([0.498, 0.655, 0], [0.035, 0.034, 0.031], skin);
  ellipsoid([0.408, 0.733, 0], [0.135, 0.092, 0.12], cap);
  ellipsoid([0.482, 0.724, 0], [0.12, 0.014, 0.12], cap);
  for (const side of [-1, 1]) {
    const shoulder: Point = [0.25, 0.49, side * 0.16];
    const elbow: Point = [0.34, 0.325, side * 0.215];
    const wrist: Point = [0.55, 0.35, side * 0.2];
    limb(shoulder, elbow, 0.068, 0.054, fabric);
    limb(elbow, wrist, 0.049, 0.033, fabric);
    ellipsoid(wrist, [0.06, 0.038, 0.04], leather);
    limb([-0.065, 0.2, side * 0.125], [0.17, 0.075, side * 0.29], 0.091, 0.065, white);
    limb([0.17, 0.075, side * 0.29], [-0.005, -0.18, side * 0.32], 0.065, 0.042, leather);
    ellipsoid([0.044, -0.185, side * 0.32], [0.105, 0.047, 0.056], leather);
    ellipsoid([0.495, 0.68, side * 0.069], [0.035, 0.042, 0.051], glass);
    ellipsoid([0.393, 0.65, side * 0.101], [0.031, 0.042, 0.017], skin);
    const stirrup = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.008, 8, 20), new THREE.MeshStandardMaterial({ color: 0xa6a39b, metalness: 0.8, roughness: 0.3 }));
    stirrup.position.set(0.03, -0.18, side * 0.33);
    rider.add(stirrup);
  }
  rider.scale.setScalar(scale);
  return rider;
}
