'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import {
  EffectComposer,
  RenderPass,
  BloomEffect,
  EffectPass,
  BlendFunction,
  VignetteEffect,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing';

// ============================================================
// TYPES & CONSTANTS
// ============================================================

interface SurvivalStats {
  health: number; maxHealth: number;
  stamina: number; maxStamina: number;
  hunger: number; maxHunger: number;
  xp: number; level: number; xpToNext: number;
  territory: number; gold: number;
  breathFuel: number; maxBreathFuel: number;
}

interface Mission {
  id: number; title: string; description: string;
  objective: string; targetCount: number; currentCount: number;
  completed: boolean; reward: string; markerPosition: THREE.Vector3;
}

interface Enemy {
  mesh: THREE.Group;
  type: 'archer' | 'catapult' | 'dragon' | 'knight' | 'boss';
  health: number; maxHealth: number; speed: number;
  attackCooldown: number; attackRange: number; damage: number;
  alive: boolean; position: THREE.Vector3;
  patrolAngle: number; fireTimer: number; aggroRange: number;
  stunned: number; hitFlash: number;
}

interface Projectile {
  mesh: THREE.Mesh; velocity: THREE.Vector3; damage: number;
  lifetime: number; fromEnemy: boolean; type: string;
}

interface FireParticle {
  mesh: THREE.Mesh; velocity: THREE.Vector3;
  lifetime: number; maxLifetime: number;
}

interface DamageNumber {
  mesh: THREE.Sprite; velocity: THREE.Vector3;
  lifetime: number; value: number;
}

const TERRAIN_SIZE = 2400;
const TERRAIN_SEGMENTS = 256;
const WATER_LEVEL = -2;

// ============================================================
// DRAGON GAME COMPONENT
// ============================================================

export default function DragonGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id); }, []);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'paused' | 'gameover' | 'victory'>('menu');
  const [stats, setStats] = useState<SurvivalStats>({
    health: 150, maxHealth: 150, stamina: 120, maxStamina: 120,
    hunger: 100, maxHunger: 100, xp: 0, level: 1, xpToNext: 100,
    territory: 0, gold: 0, breathFuel: 100, maxBreathFuel: 100,
  });
  const [currentMission, setCurrentMission] = useState<Mission | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [notification, setNotification] = useState<string>('');
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  const gameRef = useRef<{
    scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer; composer: EffectComposer;
    dragon: THREE.Group; clock: THREE.Clock;
    keys: Set<string>; mouse: { dx: number; dy: number; down: boolean; rightDown: boolean };
    stats: SurvivalStats; enemies: Enemy[]; projectiles: Projectile[];
    fireParticles: FireParticle[]; damageNumbers: DamageNumber[];
    missions: Mission[]; missionIndex: number;
    isGrounded: boolean; isFlying: boolean; isBreathingFire: boolean;
    isDiving: boolean; isSprinting: boolean;
    diveVelocity: THREE.Vector3; dragonVelocity: THREE.Vector3;
    animationId: number; terrain: THREE.Mesh; water: THREE.Mesh;
    yaw: number; pitch: number;
    wingAngle: number; wingDir: number;
    hungerTimer: number; staminaRegenTimer: number; fireBreathTimer: number;
    notificationTimer: number; dragonScale: number; gameActive: boolean;
    dayTime: number; sunLight: THREE.DirectionalLight; sunMesh: THREE.Mesh;
    ambientLight: THREE.AmbientLight; fogColor: THREE.Color;
    structures: THREE.Group[]; fireLight: THREE.PointLight;
    dragonModel: THREE.Group | null; mixer: THREE.AnimationMixer | null;
    cameraShake: number; comboCount: number; comboTimer: number;
    killStreak: number; bloomEffect: BloomEffect | null;
    missionMarkers: THREE.Group[];
  } | null>(null);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    if (gameRef.current) gameRef.current.notificationTimer = 3;
  }, []);

  const createMissions = useCallback((): Mission[] => [
    { id: 1, title: 'The Awakening', description: 'The archer garrison on the eastern hills attacks your kind. Burn them.', objective: 'Destroy the archer garrison', targetCount: 8, currentCount: 0, completed: false, reward: '+80 XP, +50 Gold', markerPosition: new THREE.Vector3(260, 0, -40) },
    { id: 2, title: 'Knight\'s Fall', description: 'Elite knights patrol the village. Show them dragon fury.', objective: 'Defeat the royal knights', targetCount: 5, currentCount: 0, completed: false, reward: '+100 XP, +75 Gold', markerPosition: new THREE.Vector3(50, 0, -65) },
    { id: 3, title: 'Rival Skies', description: 'A rival dragon rules the northern mountains. Challenge it.', objective: 'Defeat the rival dragon', targetCount: 1, currentCount: 0, completed: false, reward: '+150 XP, +100 Gold', markerPosition: new THREE.Vector3(250, 45, -200) },
    { id: 4, title: 'Siege Breaker', description: 'Catapults guard the castle walls. Destroy them.', objective: 'Destroy the catapult defenses', targetCount: 4, currentCount: 0, completed: false, reward: '+120 XP, +80 Gold', markerPosition: new THREE.Vector3(155, 35, 95) },
    { id: 5, title: 'Conquer the Castle', description: 'Clear all defenders within the castle walls.', objective: 'Clear the castle defenders', targetCount: 12, currentCount: 0, completed: false, reward: '+200 XP, +150 Gold', markerPosition: new THREE.Vector3(150, 45, 100) },
    { id: 6, title: 'The Dragon King', description: 'The ancient Dragon King threatens all. End its reign.', objective: 'Defeat the Dragon King', targetCount: 1, currentCount: 0, completed: false, reward: 'VICTORY', markerPosition: new THREE.Vector3(0, 55, 0) },
  ], []);

  // ============================================================
  // NOISE
  // ============================================================
  const noise2D = useCallback((x: number, z: number): number => {
    let val = 0, amp = 1, freq = 0.008;
    for (let i = 0; i < 6; i++) {
      val += amp * Math.sin(x * freq * 1.7 + z * freq * 0.9 + i * 13.37) * Math.cos(z * freq * 1.3 - x * freq * 0.6 + i * 7.13);
      amp *= 0.5; freq *= 2.1;
    }
    return val;
  }, []);

  // ============================================================
  // TERRAIN
  // ============================================================
  const generateTerrain = useCallback((scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const vertices = geometry.attributes.position.array as Float32Array;
    const colors = new Float32Array(vertices.length);

    const biomes = [
      { cx: -200, cz: -120, r: 140, type: 'lake' },
      { cx: 150, cz: 100, r: 100, type: 'castle' },
      { cx: -100, cz: 200, r: 140, type: 'forest' },
      { cx: 250, cz: -200, r: 200, type: 'mountain' },
      { cx: 50, cz: -80, r: 80, type: 'village' },
      { cx: -300, cz: 100, r: 120, type: 'swamp' },
      { cx: 400, cz: 0, r: 180, type: 'desert' },
      { cx: -350, cz: -300, r: 150, type: 'volcano' },
      { cx: 200, cz: 300, r: 120, type: 'forest2' },
      { cx: -150, cz: -350, r: 100, type: 'ruins' },
    ];

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i], z = vertices[i + 2];
      let y = noise2D(x, z) * 25;

      for (const b of biomes) {
        const d = Math.sqrt((x - b.cx) ** 2 + (z - b.cz) ** 2);
        if (d > b.r) continue;
        const f = 1 - d / b.r;
        switch (b.type) {
          case 'lake': y -= f * f * 40; break;
          case 'castle': y += f * f * 50; break;
          case 'mountain': y += f * f * f * 120; break;
          case 'forest': case 'forest2': y += f * 12 + noise2D(x * 2, z * 2) * f * 5; break;
          case 'village': y = y * (1 - f * 0.8); break;
          case 'swamp': y -= f * 15 + noise2D(x * 3, z * 3) * f * 3; break;
          case 'desert': y += Math.sin(x * 0.05 + z * 0.02) * f * 15; break;
          case 'volcano': y += f * f * 90; if (d < 30) y -= (1 - d / 30) * 40; break;
          case 'ruins': y += f * 8; break;
        }
      }
      vertices[i + 1] = y;

      let r = 0.22, g = 0.38, b2 = 0.12;
      if (y < WATER_LEVEL + 3) { r = 0.06; g = 0.15; b2 = 0.30; }
      else if (y > 70) { r = 0.92; g = 0.92; b2 = 0.95; }
      else if (y > 45) { const t = (y - 45) / 25; r = 0.55 + t * 0.37; g = 0.52 + t * 0.40; b2 = 0.50 + t * 0.45; }
      else if (y > 25) { r = 0.38; g = 0.35; b2 = 0.30; }
      colors[i] = r; colors[i + 1] = g; colors[i + 2] = b2;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.03 }));
    terrain.receiveShadow = true;
    scene.add(terrain);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(TERRAIN_SIZE * 1.2, TERRAIN_SIZE * 1.2).rotateX(-Math.PI / 2) as THREE.BufferGeometry,
      new THREE.MeshStandardMaterial({ color: 0x0a3d5c, transparent: true, opacity: 0.75, roughness: 0.05, metalness: 0.6 })
    );
    water.position.y = WATER_LEVEL;
    scene.add(water);

    // Volcano lava
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(25, 32).rotateX(-Math.PI / 2) as THREE.BufferGeometry,
      new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff2200, emissiveIntensity: 2, roughness: 0.3 })
    );
    lava.position.set(-350, 48, -300);
    scene.add(lava);
    const lavaLight = new THREE.PointLight(0xff4400, 5, 80);
    lavaLight.position.set(-350, 55, -300);
    scene.add(lavaLight);

    return { terrain, water };
  }, [noise2D]);

  // ============================================================
  // STRUCTURES (condensed for space)
  // ============================================================
  const createStructures = useCallback((scene: THREE.Scene) => {
    const structures: THREE.Group[] = [];
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.85, metalness: 0.1 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x454545, roughness: 0.8, metalness: 0.15 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a3b10, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7, metalness: 0.05 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xdaa520, roughness: 0.3, metalness: 0.8 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.4, metalness: 0.7 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xffaa22, emissiveIntensity: 0.8 });

    // GRAND CASTLE
    const castle = new THREE.Group();
    const keep = new THREE.Mesh(new THREE.BoxGeometry(25, 35, 25), darkStone);
    keep.position.set(150, 57, 100); keep.castShadow = true; keep.receiveShadow = true; castle.add(keep);
    const keepTop = new THREE.Mesh(new THREE.ConeGeometry(18, 10, 4), roofMat);
    keepTop.position.set(150, 80, 100); keepTop.rotation.y = Math.PI / 4; keepTop.castShadow = true; castle.add(keepTop);
    // Windows
    for (let row = 0; row < 3; row++) for (const col of [-6, 6]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.3), windowMat);
      w.position.set(150 + col, 50 + row * 8, 87.5); castle.add(w);
    }
    // Walls
    for (const wp of [
      { x: 125, z: 75, w: 50, d: 4 }, { x: 175, z: 75, w: 50, d: 4 },
      { x: 100, z: 100, w: 4, d: 50 }, { x: 200, z: 100, w: 4, d: 50 },
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wp.w, 16, wp.d), stoneMat);
      wall.position.set(wp.x, 46, wp.z); wall.castShadow = true; castle.add(wall);
    }
    // Towers
    for (const tp of [{ x: 125, z: 75 }, { x: 175, z: 75 }, { x: 125, z: 125 }, { x: 175, z: 125 }, { x: 100, z: 75 }, { x: 200, z: 125 }]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 24, 8), darkStone);
      t.position.set(tp.x, 50, tp.z); t.castShadow = true; castle.add(t);
      const tt = new THREE.Mesh(new THREE.ConeGeometry(5.5, 8, 8), roofMat);
      tt.position.set(tp.x, 66, tp.z); tt.castShadow = true; castle.add(tt);
    }
    // Gate
    const gate = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 4), ironMat);
    gate.position.set(150, 45, 75); castle.add(gate);
    // Courtyard lights
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff8833, 2, 25); l.position.set(130 + i * 15, 50, 95); castle.add(l); }
    scene.add(castle); structures.push(castle);

    // VILLAGE
    const village = new THREE.Group();
    for (const hp of [
      { x: 30, z: -60 }, { x: 45, z: -50 }, { x: 20, z: -75 },
      { x: 55, z: -65 }, { x: 35, z: -85 }, { x: 60, z: -80 },
      { x: 25, z: -45 }, { x: 50, z: -40 }, { x: 70, z: -55 },
      { x: 40, z: -95 }, { x: 15, z: -55 }, { x: 65, z: -70 },
    ]) {
      const house = new THREE.Group();
      const w = 5 + Math.random() * 4, h = 4 + Math.random() * 2, d = 5 + Math.random() * 4;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMat);
      wall.position.y = h / 2; wall.castShadow = true; house.add(wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.7, 4, 4), roofMat);
      roof.position.y = h + 2; roof.rotation.y = Math.PI / 4; roof.castShadow = true; house.add(roof);
      house.position.set(hp.x, 0, hp.z); house.rotation.y = Math.random() * 0.4 - 0.2; village.add(house);
    }
    const church = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 16), stoneMat);
    church.position.set(42, 5, -68); church.castShadow = true; village.add(church);
    const steeple = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 4), roofMat);
    steeple.position.set(42, 16, -68); village.add(steeple);
    scene.add(village); structures.push(village);

    // FORESTS
    const treeMats = [
      new THREE.MeshStandardMaterial({ color: 0x1a4d0a, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ color: 0x0f3305, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xcc6600, roughness: 0.7 }),
    ];
    for (const fc of [{ cx: -100, cz: 200, n: 200, mi: 0 }, { cx: 200, cz: 300, n: 120, mi: 1 }, { cx: -200, cz: -200, n: 80, mi: 2 }]) {
      const forest = new THREE.Group();
      for (let i = 0; i < fc.n; i++) {
        const a = Math.random() * 6.28, dist = Math.random() * 120;
        const tree = new THREE.Group();
        const th = 5 + Math.random() * 6;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, th, 6), new THREE.MeshStandardMaterial({ color: 0x3a1f08, roughness: 0.95 }));
        trunk.position.y = th / 2; trunk.castShadow = true; tree.add(trunk);
        const ls = 2.5 + Math.random() * 3;
        for (let l = 0; l < 3; l++) {
          const leaves = new THREE.Mesh(new THREE.ConeGeometry(ls * (1 - l * 0.25), ls * 1.5, 7), treeMats[fc.mi]);
          leaves.position.y = th + l * ls * 0.8 + ls * 0.5; leaves.castShadow = true; tree.add(leaves);
        }
        tree.position.set(fc.cx + Math.cos(a) * dist, 0, fc.cz + Math.sin(a) * dist); forest.add(tree);
      }
      scene.add(forest); structures.push(forest);
    }

    // WATCHTOWERS
    for (const wp of [{ x: 200, z: 0 }, { x: -200, z: 0 }, { x: 0, z: 250 }, { x: 0, z: -250 }, { x: 300, z: -100 }]) {
      const tower = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 15, 8), stoneMat);
      t.position.y = 7.5; t.castShadow = true; tower.add(t);
      const tt = new THREE.Mesh(new THREE.ConeGeometry(3.5, 5, 8), roofMat);
      tt.position.y = 17.5; tt.castShadow = true; tower.add(tt);
      const fl = new THREE.PointLight(0xff6622, 3, 30); fl.position.y = 15; tower.add(fl);
      tower.position.set(wp.x, 0, wp.z); scene.add(tower); structures.push(tower);
    }

    return structures;
  }, []);

  // ============================================================
  // PROCEDURAL DRAGON (fallback)
  // ============================================================
  const createProceduralDragon = useCallback((scene: THREE.Scene) => {
    const dragon = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2d1b0e, roughness: 0.5, metalness: 0.4 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 3 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8).scale(1, 0.7, 1.8) as THREE.BufferGeometry, bodyMat);
    body.castShadow = true; dragon.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 3.5, 8), bodyMat);
    neck.position.set(0, 0.8, -3.5); neck.rotation.x = -0.4; neck.castShadow = true; dragon.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8).scale(0.8, 0.7, 1.2) as THREE.BufferGeometry, bodyMat);
    head.position.set(0, 1.8, -5.5); head.castShadow = true; dragon.add(head);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2, 8), bodyMat);
    snout.position.set(0, 1.5, -7); snout.rotation.x = Math.PI / 2; dragon.add(snout);

    [-0.6, 0.6].forEach(x => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), eyeMat);
      eye.position.set(x, 2.2, -5.8); dragon.add(eye);
    });

    // Horns
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.3, metalness: 0.5 });
    [[-0.5, 0.3], [0.5, -0.3]].forEach(([x, rz]) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 2, 6), hornMat);
      horn.position.set(x as number, 3.0, -5); horn.rotation.x = -0.3; horn.rotation.z = rz as number; dragon.add(horn);
    });

    // Wings (larger)
    const ws = new THREE.Shape();
    ws.moveTo(0, 0); ws.lineTo(1.5, 0.8); ws.lineTo(5, 3.5); ws.lineTo(7, 3);
    ws.lineTo(6, 1.2); ws.lineTo(3.5, -0.3); ws.lineTo(0.5, -0.5); ws.lineTo(0, 0);
    const wGeo = new THREE.ShapeGeometry(ws);

    const lw = new THREE.Mesh(wGeo, wingMat); lw.position.set(1.5, 0.5, -1);
    lw.rotation.y = Math.PI / 2; lw.rotation.z = 0.3; lw.name = 'leftWing'; dragon.add(lw);
    const rw = new THREE.Mesh(wGeo, wingMat); rw.position.set(-1.5, 0.5, -1);
    rw.rotation.y = -Math.PI / 2; rw.rotation.z = -0.3; rw.name = 'rightWing'; dragon.add(rw);

    // Tail
    for (let i = 0; i < 10; i++) {
      const t = i / 10, radius = 0.8 * (1 - t * 0.85);
      const seg = new THREE.Mesh(new THREE.SphereGeometry(radius, 6, 4), bodyMat);
      seg.position.set(0, -0.3 + t * 0.5, 2 + i * 1.1); seg.castShadow = true; dragon.add(seg);
    }
    const tailSpike = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.5, 6), hornMat);
    tailSpike.position.set(0, 2.5, 2 + 10 * 1.1); tailSpike.rotation.x = Math.PI / 2; dragon.add(tailSpike);

    // Back spikes
    for (let i = 0; i < 8; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 4), hornMat);
      spike.position.set(0, 1.8 - i * 0.04, -2.5 + i * 0.7); dragon.add(spike);
    }

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.5, 6);
    [{ x: 1.3, z: -0.5 }, { x: -1.3, z: -0.5 }, { x: 1.3, z: 1.5 }, { x: -1.3, z: 1.5 }].forEach(lp => {
      const leg = new THREE.Mesh(legGeo, bodyMat); leg.position.set(lp.x, -1.5, lp.z); leg.castShadow = true; dragon.add(leg);
    });

    // Fire light
    const fireLight = new THREE.PointLight(0xff4400, 0, 30);
    fireLight.position.set(0, 1.5, -7.5); dragon.add(fireLight);

    dragon.position.set(0, 20, 0);
    dragon.castShadow = true;
    scene.add(dragon);
    return dragon;
  }, []);

  // ============================================================
  // MISSION MARKERS - Glowing beacons visible from far away
  // ============================================================
  const createMissionMarkers = useCallback((scene: THREE.Scene, missions: Mission[]): THREE.Group[] => {
    const markers: THREE.Group[] = [];
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 3, roughness: 0.1, metalness: 0.9 });
    const markerMat2 = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 2, roughness: 0.2, metalness: 0.8 });

    missions.forEach((mission, idx) => {
      const marker = new THREE.Group();
      const pos = mission.markerPosition;

      // Tall glowing pillar
      const pillarGeo = new THREE.CylinderGeometry(0.5, 0.8, 40, 8);
      const pillar = new THREE.Mesh(pillarGeo, markerMat);
      pillar.position.y = 20;
      marker.add(pillar);

      // Rotating diamond on top
      const diamondGeo = new THREE.OctahedronGeometry(3, 0);
      const diamond = new THREE.Mesh(diamondGeo, markerMat2);
      diamond.position.y = 43;
      diamond.name = 'markerDiamond';
      marker.add(diamond);

      // Second diamond below
      const diamond2 = new THREE.Mesh(new THREE.OctahedronGeometry(2, 0), markerMat);
      diamond2.position.y = 38;
      diamond2.name = 'markerDiamond2';
      marker.add(diamond2);

      // Ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.3, 8, 24), markerMat);
      ring.position.y = 43;
      ring.rotation.x = Math.PI / 2;
      ring.name = 'markerRing';
      marker.add(ring);

      // Light beam going up
      const beamGeo = new THREE.CylinderGeometry(0.3, 2, 60, 8);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.15 });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 70;
      marker.add(beam);

      // Point light
      const light = new THREE.PointLight(0xffaa00, 8, 100);
      light.position.y = 43;
      marker.add(light);

      // Mission number label using sprite
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#00000088';
      ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 64px sans-serif'; ctx.fillStyle = '#ffaa00';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${mission.id}`, 64, 64);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.y = 55;
      sprite.scale.set(10, 10, 1);
      marker.add(sprite);

      marker.position.set(pos.x, 0, pos.z);
      marker.visible = idx === 0; // Only show current mission marker
      scene.add(marker);
      markers.push(marker);
    });

    return markers;
  }, []);

  // ============================================================
  // CREATE ENEMY
  // ============================================================
  const createEnemyMesh = useCallback((type: string, position: THREE.Vector3) => {
    const group = new THREE.Group();
    if (type === 'archer') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7, metalness: 0.3 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.6, 8), bodyMat);
      body.position.y = 0.8; body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshStandardMaterial({ color: 0xc4956a }));
      head.position.y = 1.9; group.add(head);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.33, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7 }));
      helmet.position.y = 2.0; group.add(helmet);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x6B3410 }));
      bow.position.set(0.5, 1.3, 0); bow.rotation.z = Math.PI / 2; group.add(bow);
      group.position.copy(position);
      return { mesh: group, health: 35, speed: 2.5, attackCooldown: 1.8, attackRange: 100, damage: 10, aggroRange: 120 };
    }
    if (type === 'knight') {
      const armor = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.3 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.8, 8), armor);
      body.position.y = 0.9; body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), armor);
      head.position.y = 2.1; group.add(head);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 }));
      blade.position.set(0.6, 1.2, 0); blade.rotation.z = -0.3; group.add(blade);
      group.position.copy(position);
      return { mesh: group, health: 80, speed: 3.5, attackCooldown: 2.5, attackRange: 30, damage: 18, aggroRange: 60 };
    }
    if (type === 'catapult') {
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a2d0c, roughness: 0.8 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 2.5), woodMat);
      base.position.y = 0.6; base.castShadow = true; group.add(base);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5, 0.35), woodMat);
      arm.position.set(0, 3, -0.5); arm.rotation.x = -0.5; group.add(arm);
      group.position.copy(position);
      return { mesh: group, health: 100, speed: 0, attackCooldown: 3.5, attackRange: 150, damage: 30, aggroRange: 160 };
    }
    if (type === 'dragon' || type === 'boss') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.45, metalness: 0.4 });
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x5a0000, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8).scale(1, 0.7, 1.8) as THREE.BufferGeometry, bodyMat);
      body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8).scale(0.8, 0.7, 1.2) as THREE.BufferGeometry, bodyMat);
      head.position.set(0, 0.8, -3.8); head.castShadow = true; group.add(head);
      [-0.5, 0.5].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), eyeMat); e.position.set(x, 1.3, -4); group.add(e); });
      const ws = new THREE.Shape(); ws.moveTo(0, 0); ws.lineTo(1, 0.5); ws.lineTo(4, 2.5); ws.lineTo(6, 2); ws.lineTo(5, 0.8); ws.lineTo(2.5, -0.3); ws.lineTo(0, 0);
      const wGeo = new THREE.ShapeGeometry(ws);
      const lw = new THREE.Mesh(wGeo, wingMat); lw.position.set(1.5, 0.5, -0.5); lw.rotation.y = Math.PI / 2; lw.name = 'leftWing'; group.add(lw);
      const rw = new THREE.Mesh(wGeo, wingMat); rw.position.set(-1.5, 0.5, -0.5); rw.rotation.y = -Math.PI / 2; rw.name = 'rightWing'; group.add(rw);
      const fLight = new THREE.PointLight(0xff0000, 0, 20); fLight.position.set(0, 0.8, -5.5); group.add(fLight);
      group.position.copy(position);
      const isBoss = type === 'boss';
      return { mesh: group, health: isBoss ? 500 : 150, speed: isBoss ? 14 : 10, attackCooldown: isBoss ? 1.2 : 2.2, attackRange: isBoss ? 70 : 55, damage: isBoss ? 28 : 15, aggroRange: isBoss ? 200 : 120 };
    }
    return { mesh: group, health: 50, speed: 3, attackCooldown: 2, attackRange: 50, damage: 10, aggroRange: 80 };
  }, []);

  // ============================================================
  // SPAWN ENEMIES
  // ============================================================
  const spawnEnemies = useCallback((scene: THREE.Scene) => {
    const enemies: Enemy[] = [];
    const addEnemy = (type: string, pos: THREE.Vector3) => {
      const data = createEnemyMesh(type, pos);
      scene.add(data.mesh);
      enemies.push({ ...data, type: type as Enemy['type'], maxHealth: data.health, alive: true, position: pos.clone(), patrolAngle: Math.random() * 6.28, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    };
    // Mission 1: Archers
    for (let i = 0; i < 8; i++) addEnemy('archer', new THREE.Vector3(250 + Math.random() * 60, 12, -50 + Math.random() * 40));
    // Mission 2: Knights
    for (let i = 0; i < 5; i++) addEnemy('knight', new THREE.Vector3(50 + Math.random() * 30, 0, -60 + Math.random() * 20));
    // Mission 3: Rival dragon
    addEnemy('dragon', new THREE.Vector3(250, 45, -200));
    // Mission 4: Catapults
    [new THREE.Vector3(185, 35, 75), new THREE.Vector3(115, 35, 80), new THREE.Vector3(150, 35, 130), new THREE.Vector3(170, 35, 120)].forEach(p => addEnemy('catapult', p));
    // Mission 5: Castle defenders
    for (let i = 0; i < 12; i++) {
      const isKnight = i < 4;
      addEnemy(isKnight ? 'knight' : 'archer', isKnight
        ? new THREE.Vector3(140 + Math.random() * 20, 40, 90 + Math.random() * 15)
        : new THREE.Vector3(130 + Math.random() * 40, 55, 80 + Math.random() * 40));
    }
    // Mission 6: Dragon King
    addEnemy('boss', new THREE.Vector3(0, 55, 0));
    // Patrols
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; addEnemy('archer', new THREE.Vector3(Math.cos(a) * 200, 0, Math.sin(a) * 200)); }
    return enemies;
  }, [createEnemyMesh]);

  const getTerrainHeight = useCallback((x: number, z: number, terrain: THREE.Mesh): number => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(terrain);
    return hits.length > 0 ? hits[0].point.y : 0;
  }, []);

  const breatheFire = useCallback(() => {
    const game = gameRef.current;
    if (!game || game.stats.stamina < 3 || game.stats.breathFuel < 1) return;
    game.stats.stamina -= 3; game.stats.breathFuel -= 2;
    game.isBreathingFire = true; game.fireLight.intensity = 8;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.dragon.quaternion);
    const pos = game.dragon.position.clone().add(dir.clone().multiplyScalar(5));
    pos.y += 1.5;
    for (let i = 0; i < 8; i++) {
      const fireMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + Math.random() * 0.5, 6, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.04 + Math.random() * 0.08, 1, 0.5 + Math.random() * 0.4), transparent: true, opacity: 0.95 })
      );
      fireMesh.position.copy(pos);
      const vel = dir.clone().multiplyScalar(40 + Math.random() * 25);
      vel.x += (Math.random() - 0.5) * 12; vel.y += (Math.random() - 0.5) * 8; vel.z += (Math.random() - 0.5) * 12;
      game.scene.add(fireMesh);
      game.fireParticles.push({ mesh: fireMesh, velocity: vel, lifetime: 0.6 + Math.random() * 0.5, maxLifetime: 1.1 });
    }
  }, []);

  const enemyBreatheFire = useCallback((enemy: Enemy) => {
    const game = gameRef.current; if (!game) return;
    const dir = new THREE.Vector3().subVectors(game.dragon.position, enemy.mesh.position).normalize();
    const pos = enemy.mesh.position.clone().add(dir.clone().multiplyScalar(3)); pos.y += 0.8;
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.35 + Math.random() * 0.25, 5, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.02 + Math.random() * 0.04, 1, 0.5 + Math.random() * 0.3), transparent: true, opacity: 0.9 }));
      m.position.copy(pos);
      const vel = dir.clone().multiplyScalar(28 + Math.random() * 18);
      vel.x += (Math.random() - 0.5) * 12; vel.y += (Math.random() - 0.5) * 10; vel.z += (Math.random() - 0.5) * 12;
      game.scene.add(m); game.fireParticles.push({ mesh: m, velocity: vel, lifetime: 0.7 + Math.random() * 0.3, maxLifetime: 1.0 });
    }
  }, []);

  const shootArrow = useCallback((enemy: Enemy) => {
    const game = gameRef.current; if (!game) return;
    const dir = new THREE.Vector3().subVectors(game.dragon.position, enemy.mesh.position).normalize();
    const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
    arrow.position.copy(enemy.mesh.position); arrow.position.y += 2;
    arrow.lookAt(game.dragon.position); arrow.rotateX(Math.PI / 2);
    game.scene.add(arrow);
    game.projectiles.push({ mesh: arrow, velocity: dir.clone().multiplyScalar(55), damage: enemy.damage, lifetime: 3.5, fromEnemy: true, type: 'arrow' });
  }, []);

  const shootRock = useCallback((enemy: Enemy) => {
    const game = gameRef.current; if (!game) return;
    const dir = new THREE.Vector3().subVectors(game.dragon.position, enemy.mesh.position).normalize();
    const rock = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 }));
    rock.position.copy(enemy.mesh.position); rock.position.y += 5;
    const vel = dir.clone().multiplyScalar(40); vel.y += 18;
    game.scene.add(rock);
    game.projectiles.push({ mesh: rock, velocity: vel, damage: enemy.damage, lifetime: 5, fromEnemy: true, type: 'rock' });
  }, []);

  const createDamageNumber = useCallback((position: THREE.Vector3, damage: number) => {
    const game = gameRef.current; if (!game) return;
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 48px sans-serif'; ctx.fillStyle = '#ff4444'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.textAlign = 'center';
    ctx.strokeText(`${Math.round(damage)}`, 64, 48); ctx.fillText(`${Math.round(damage)}`, 64, 48);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.position.copy(position); sprite.position.y += 4; sprite.scale.set(4, 2, 1);
    game.scene.add(sprite);
    game.damageNumbers.push({ mesh: sprite, velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2), lifetime: 1.2, value: damage });
  }, []);

  // ============================================================
  // GAME LOOP - FIXED CONTROLS
  // ============================================================
  const gameLoopRef = useRef<() => void>(() => {});

  const gameLoop = useCallback(() => {
    const game = gameRef.current;
    if (!game || !game.gameActive) return;
    const delta = Math.min(game.clock.getDelta(), 0.05);
    const dragon = game.dragon;
    const keys = game.keys;

    // ---- Day/Night ----
    game.dayTime += delta * 0.015;
    const sunAngle = game.dayTime;
    game.sunLight.position.set(Math.cos(sunAngle) * 400, Math.sin(sunAngle) * 300 + 50, 100);
    const sunIntensity = Math.max(0.15, Math.sin(sunAngle) * 0.5 + 0.5);
    game.sunLight.intensity = sunIntensity * 1.5;
    game.ambientLight.intensity = 0.15 + sunIntensity * 0.35;
    if (game.sunMesh) game.sunMesh.position.set(Math.cos(sunAngle) * 600, Math.sin(sunAngle) * 450 + 100, 150);
    game.scene.fog = new THREE.FogExp2(game.fogColor, 0.0012 + (1 - sunIntensity) * 0.002);
    const skyR = 0.15 + sunIntensity * 0.35, skyG = 0.18 + sunIntensity * 0.37, skyB = 0.25 + sunIntensity * 0.45;
    game.fogColor.setRGB(skyR, skyG, skyB); (game.scene.background as THREE.Color).copy(game.fogColor);
    if (game.bloomEffect) game.bloomEffect.intensity = 0.8 + sunIntensity * 1.0;

    // ---- Pointer Lock Mouse Look ----
    // Mouse rotates yaw/pitch directly
    game.yaw -= game.mouse.dx * 0.003;
    game.pitch -= game.mouse.dy * 0.003;
    game.pitch = Math.max(-1.2, Math.min(1.0, game.pitch));
    game.mouse.dx = 0;
    game.mouse.dy = 0;

    // ---- Movement (FIXED: W = forward on horizon, not pitch direction) ----
    const moveSpeed = 25 * delta;
    const flySpeed = 40 * delta;
    const sprintMul = (keys.has('e') && game.stats.stamina > 0) ? 1.8 : 1;

    // Horizontal forward direction (NO pitch influence)
    const flatForward = new THREE.Vector3(-Math.sin(game.yaw), 0, -Math.cos(game.yaw)).normalize();
    const flatRight = new THREE.Vector3(Math.cos(game.yaw), 0, -Math.sin(game.yaw)).normalize();

    // Apply movement
    if (keys.has('w') || keys.has('arrowup')) {
      const speed = game.isFlying ? flySpeed * sprintMul : moveSpeed * sprintMul;
      dragon.position.add(flatForward.clone().multiplyScalar(speed));
      if (game.isSprinting) game.stats.stamina -= delta * 6;
    }
    if (keys.has('s') || keys.has('arrowdown')) {
      const speed = game.isFlying ? flySpeed * 0.4 : moveSpeed * 0.5;
      dragon.position.add(flatForward.clone().multiplyScalar(-speed));
    }
    if (keys.has('a') || keys.has('arrowleft')) {
      const speed = game.isFlying ? flySpeed * 0.6 : moveSpeed * 0.7;
      dragon.position.add(flatRight.clone().multiplyScalar(-speed));
    }
    if (keys.has('d') || keys.has('arrowright')) {
      const speed = game.isFlying ? flySpeed * 0.6 : moveSpeed * 0.7;
      dragon.position.add(flatRight.clone().multiplyScalar(speed));
    }

    // Vertical movement
    game.isSprinting = keys.has('e') && game.stats.stamina > 0;
    if (keys.has(' ') && game.stats.stamina > 0) {
      game.isFlying = true;
      dragon.position.y += flySpeed * 2 * sprintMul;
      game.stats.stamina -= delta * 6;
      game.isGrounded = false;
    }
    if (keys.has('shift')) {
      if (game.isFlying) dragon.position.y -= flySpeed * 2.5;
    }

    // Dive attack
    if (game.isDiving && game.isFlying) {
      game.diveVelocity.add(flatForward.clone().multiplyScalar(delta * 100));
      game.diveVelocity.y -= delta * 50;
      dragon.position.add(game.diveVelocity.clone().multiplyScalar(delta));
    }

    // Gravity
    const terrainHeight = getTerrainHeight(dragon.position.x, dragon.position.z, game.terrain);
    const groundLevel = Math.max(terrainHeight + 3, WATER_LEVEL + 3);

    if (!game.isFlying && !game.isDiving) {
      if (dragon.position.y > groundLevel + 0.5) {
        game.dragonVelocity.y -= 25 * delta;
        dragon.position.add(game.dragonVelocity.clone().multiplyScalar(delta));
      }
      if (dragon.position.y <= groundLevel) {
        dragon.position.y = groundLevel;
        game.dragonVelocity.set(0, 0, 0);
        game.isGrounded = true; game.isFlying = false;
      }
    }
    if (game.isFlying && dragon.position.y <= groundLevel) {
      dragon.position.y = groundLevel;
      game.isFlying = false; game.isGrounded = true; game.isDiving = false;
      game.diveVelocity.set(0, 0, 0); game.dragonVelocity.set(0, 0, 0);
      game.cameraShake = 0.5;
    }

    // ---- Dragon orientation (yaw + pitch for visuals only) ----
    dragon.rotation.set(0, 0, 0);
    dragon.rotateY(game.yaw);
    // Subtle pitch tilt for visual feedback
    const visualPitch = game.isFlying ? game.pitch * 0.4 : 0;
    dragon.rotateX(visualPitch);
    // Bank on strafe
    const bankTarget = (keys.has('a') || keys.has('arrowleft')) ? 0.2 : (keys.has('d') || keys.has('arrowright')) ? -0.2 : 0;
    dragon.rotateZ(bankTarget);

    // Wing animation
    if (game.isFlying || keys.has(' ')) {
      game.wingAngle += game.wingDir * delta * 10;
      if (game.wingAngle > 0.9 || game.wingAngle < -0.2) game.wingDir *= -1;
    } else { game.wingAngle = 0.3; }
    dragon.traverse(child => {
      if (child.name === 'leftWing') child.rotation.z = game.wingAngle;
      if (child.name === 'rightWing') child.rotation.z = -game.wingAngle;
    });
    if (game.mixer) game.mixer.update(delta);

    // Survival regen
    game.staminaRegenTimer += delta;
    if (game.staminaRegenTimer > 0.4) {
      game.staminaRegenTimer = 0;
      const staminaGain = game.isGrounded ? 4 : 1;
      game.stats.stamina = Math.min(game.stats.maxStamina, game.stats.stamina + staminaGain);
      game.stats.breathFuel = Math.min(game.stats.maxBreathFuel, game.stats.breathFuel + (game.isGrounded ? 2 : 0.5));
    }
    game.hungerTimer += delta;
    if (game.hungerTimer > 4) { game.hungerTimer = 0; game.stats.hunger = Math.max(0, game.stats.hunger - 2); if (game.stats.hunger <= 0) game.stats.health -= 4; }

    // Fire breath
    if (game.isBreathingFire) { game.fireBreathTimer += delta; if (game.fireBreathTimer > 0.08) { game.fireBreathTimer = 0; breatheFire(); } }
    if (!game.mouse.down) { game.isBreathingFire = false; game.fireLight.intensity *= 0.85; }

    // Dive
    if (game.mouse.rightDown && game.isFlying && !game.isDiving) {
      game.isDiving = true;
      game.diveVelocity = flatForward.clone().multiplyScalar(40);
      game.diveVelocity.y = -20;
    }

    // Roar (R)
    if (keys.has('r') && game.stats.stamina > 20) {
      game.stats.stamina -= 20; game.cameraShake = 0.8;
      game.enemies.forEach(e => { if (e.alive && e.mesh.position.distanceTo(dragon.position) < 30) e.stunned = 3; });
      keys.delete('r');
    }

    // ---- Camera (CLOSE third-person, follows behind dragon) ----
    const camDist = 12;
    const camHeight = 5;
    const camYaw = game.yaw;
    const camPitch = game.isFlying ? game.pitch * 0.3 : 0.15; // Slight look-down when grounded

    const idealOffset = new THREE.Vector3(
      dragon.position.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      dragon.position.y + camHeight + Math.sin(camPitch) * camDist * 0.5,
      dragon.position.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist
    );
    const idealLookAt = new THREE.Vector3(
      dragon.position.x - Math.sin(camYaw) * 10,
      dragon.position.y + 2,
      dragon.position.z - Math.cos(camYaw) * 10
    );

    game.camera.position.lerp(idealOffset, 8 * delta);
    game.camera.lookAt(idealLookAt);

    if (game.cameraShake > 0) {
      game.camera.position.x += (Math.random() - 0.5) * game.cameraShake;
      game.camera.position.y += (Math.random() - 0.5) * game.cameraShake;
      game.cameraShake *= 0.9; if (game.cameraShake < 0.01) game.cameraShake = 0;
    }

    // ---- Enemies AI ----
    game.comboTimer -= delta;
    if (game.comboTimer <= 0) { game.comboCount = 0; game.killStreak = 0; }

    game.enemies.forEach(enemy => {
      if (!enemy.alive) return;
      enemy.fireTimer += delta;
      if (enemy.stunned > 0) { enemy.stunned -= delta; return; }
      if (enemy.hitFlash > 0) { enemy.hitFlash -= delta; }
      const distToPlayer = enemy.mesh.position.distanceTo(dragon.position);

      if (enemy.type === 'dragon' || enemy.type === 'boss') {
        enemy.patrolAngle += delta * 0.4;
        if (distToPlayer < enemy.aggroRange) {
          const toP = new THREE.Vector3().subVectors(dragon.position, enemy.mesh.position).normalize();
          enemy.mesh.position.add(toP.multiplyScalar(enemy.speed * delta));
          enemy.mesh.lookAt(dragon.position);
          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) { enemy.fireTimer = 0; enemyBreatheFire(enemy); }
        } else {
          const pR = 50, cx = enemy.type === 'boss' ? 0 : 250, cz = enemy.type === 'boss' ? 0 : -200;
          enemy.mesh.position.x = cx + Math.cos(enemy.patrolAngle) * pR;
          enemy.mesh.position.z = cz + Math.sin(enemy.patrolAngle) * pR;
          enemy.mesh.position.y = 40 + Math.sin(enemy.patrolAngle * 2) * 12;
          enemy.mesh.rotation.y = enemy.patrolAngle + Math.PI / 2;
        }
        const ew = Math.sin(enemy.patrolAngle * 5) * 0.6;
        enemy.mesh.traverse(c => { if (c.name === 'leftWing') c.rotation.z = ew; if (c.name === 'rightWing') c.rotation.z = -ew; });
      } else if (enemy.type === 'knight') {
        if (distToPlayer < enemy.aggroRange) {
          const toP = new THREE.Vector3().subVectors(dragon.position, enemy.mesh.position).normalize();
          if (distToPlayer > 5) enemy.mesh.position.add(toP.multiplyScalar(enemy.speed * delta));
          enemy.mesh.lookAt(dragon.position);
          if (distToPlayer < 8 && enemy.fireTimer > enemy.attackCooldown) {
            enemy.fireTimer = 0; game.stats.health -= enemy.damage; game.cameraShake = 0.3;
            createDamageNumber(dragon.position.clone(), enemy.damage);
          }
        }
      } else if (enemy.type === 'archer') {
        if (distToPlayer < enemy.aggroRange) {
          enemy.mesh.lookAt(dragon.position);
          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) { enemy.fireTimer = 0; shootArrow(enemy); }
        }
      } else if (enemy.type === 'catapult') {
        if (distToPlayer < enemy.aggroRange) {
          enemy.mesh.lookAt(dragon.position);
          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) { enemy.fireTimer = 0; shootRock(enemy); }
        }
      }
    });

    // ---- Projectiles ----
    game.projectiles = game.projectiles.filter(proj => {
      proj.lifetime -= delta; if (proj.lifetime <= 0) { game.scene.remove(proj.mesh); return false; }
      proj.mesh.position.add(proj.velocity.clone().multiplyScalar(delta));
      if (proj.type === 'rock') proj.velocity.y -= 15 * delta;
      if (proj.fromEnemy) {
        const dist = proj.mesh.position.distanceTo(dragon.position);
        if (dist < 4 * game.dragonScale) {
          game.stats.health -= proj.damage; game.cameraShake = proj.type === 'rock' ? 0.6 : 0.2;
          createDamageNumber(dragon.position.clone(), proj.damage);
          game.scene.remove(proj.mesh); return false;
        }
      }
      return true;
    });

    // ---- Fire Particles ----
    game.fireParticles = game.fireParticles.filter(particle => {
      particle.lifetime -= delta; if (particle.lifetime <= 0) { game.scene.remove(particle.mesh); return false; }
      particle.mesh.position.add(particle.velocity.clone().multiplyScalar(delta));
      particle.velocity.y += 6 * delta;
      const lr = particle.lifetime / particle.maxLifetime;
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = lr;
      particle.mesh.scale.setScalar(lr * 1.5);

      for (const enemy of game.enemies) {
        if (!enemy.alive) continue;
        const dist = particle.mesh.position.distanceTo(enemy.mesh.position);
        const hitR = enemy.type === 'boss' ? 7 : 4;
        if (dist < hitR) {
          const dmg = 18 + game.stats.level * 2;
          enemy.health -= dmg; enemy.hitFlash = 0.15;
          createDamageNumber(enemy.mesh.position.clone(), dmg);
          game.comboCount++; game.comboTimer = 3; game.killStreak++;

          if (enemy.health <= 0) {
            enemy.alive = false; game.scene.remove(enemy.mesh);
            const xpG = enemy.type === 'boss' ? 300 : enemy.type === 'dragon' ? 80 : enemy.type === 'catapult' ? 40 : enemy.type === 'knight' ? 35 : 20;
            const goldG = enemy.type === 'boss' ? 500 : enemy.type === 'dragon' ? 120 : enemy.type === 'knight' ? 30 : 15;
            game.stats.xp += xpG; game.stats.gold += goldG;
            game.stats.hunger = Math.min(game.stats.maxHunger, game.stats.hunger + 8);
            if (game.killStreak > 1) showNotification(`${game.killStreak}x Kill Streak! +${goldG} Gold`);

            if (game.stats.xp >= game.stats.xpToNext) {
              game.stats.level++; game.stats.xp -= game.stats.xpToNext;
              game.stats.xpToNext = Math.floor(game.stats.xpToNext * 1.6);
              game.stats.maxHealth += 15; game.stats.health = game.stats.maxHealth;
              game.stats.maxStamina += 12; game.stats.stamina = game.stats.maxStamina;
              game.stats.maxBreathFuel += 10; game.stats.breathFuel = game.stats.maxBreathFuel;
              game.dragonScale = 1 + game.stats.level * 0.08;
              dragon.scale.setScalar(game.dragonScale);
              game.cameraShake = 0.5;
              showNotification(`LEVEL UP! Level ${game.stats.level}! Dragon grows!`);
            }

            // Mission progress
            const mi = game.missionIndex;
            if (mi < game.missions.length && !game.missions[mi].completed) {
              const m = game.missions[mi];
              let matches = false;
              if (mi === 0 && enemy.type === 'archer' && enemy.mesh.position.x > 200) matches = true;
              if (mi === 1 && enemy.type === 'knight') matches = true;
              if (mi === 2 && enemy.type === 'dragon') matches = true;
              if (mi === 3 && enemy.type === 'catapult') matches = true;
              if (mi === 4 && (enemy.type === 'archer' || enemy.type === 'knight') && enemy.mesh.position.x < 200 && enemy.mesh.position.x > 100) matches = true;
              if (mi === 5 && enemy.type === 'boss') matches = true;
              if (matches) {
                m.currentCount++;
                if (m.currentCount >= m.targetCount) {
                  m.completed = true; showNotification(`Mission Complete: ${m.title}!`);
                  // Update marker visibility
                  game.missionMarkers.forEach((mk, idx) => mk.visible = idx === mi + 1);
                  if (mi < game.missions.length - 1) game.missionIndex = mi + 1;
                }
              }
            }
          }
          game.scene.remove(particle.mesh); return false;
        }
      }
      return true;
    });

    // Damage numbers
    game.damageNumbers = game.damageNumbers.filter(dn => {
      dn.lifetime -= delta; if (dn.lifetime <= 0) { game.scene.remove(dn.mesh); return false; }
      dn.mesh.position.add(dn.velocity.clone().multiplyScalar(delta)); dn.velocity.y -= 3 * delta;
      (dn.mesh.material as THREE.SpriteMaterial).opacity = dn.lifetime / 1.2; return true;
    });

    // Dive landing
    if (game.isDiving && game.isGrounded) {
      game.isDiving = false; game.diveVelocity.set(0, 0, 0); game.cameraShake = 1.0;
      game.enemies.forEach(e => {
        if (!e.alive) return;
        const dist = e.mesh.position.distanceTo(dragon.position);
        if (dist < 20) {
          const dmg = 60 + game.stats.level * 5; e.health -= dmg;
          createDamageNumber(e.mesh.position.clone(), dmg);
          if (e.health <= 0) { e.alive = false; game.scene.remove(e.mesh); game.stats.xp += 30; game.stats.gold += 20; }
        }
      });
    }

    // Animate mission markers
    game.missionMarkers.forEach(mk => {
      if (!mk.visible) return;
      mk.traverse(c => {
        if (c.name === 'markerDiamond' || c.name === 'markerDiamond2') {
          c.rotation.y += delta * 2;
          c.position.y = (c.name === 'markerDiamond' ? 43 : 38) + Math.sin(Date.now() * 0.003) * 2;
        }
        if (c.name === 'markerRing') { c.rotation.z += delta * 1.5; }
      });
    });

    // Clamp position
    const boundary = TERRAIN_SIZE / 2 - 30;
    dragon.position.x = Math.max(-boundary, Math.min(boundary, dragon.position.x));
    dragon.position.z = Math.max(-boundary, Math.min(boundary, dragon.position.z));
    if (dragon.position.y > 200) dragon.position.y = 200;

    // Update state
    setStats({ ...game.stats });
    if (game.missionIndex < game.missions.length) {
      const m = game.missions[game.missionIndex];
      if (!m.completed) setCurrentMission({ ...m });
      else if (game.missionIndex === game.missions.length - 1) { setGameState('victory'); game.gameActive = false; }
    }
    if (game.notificationTimer > 0) { game.notificationTimer -= delta; if (game.notificationTimer <= 0) setNotification(''); }
    if (game.stats.health <= 0) { game.stats.health = 0; setGameState('gameover'); game.gameActive = false; }

    game.composer.render(delta);
    game.animationId = requestAnimationFrame(() => gameLoopRef.current());
  }, [breatheFire, createDamageNumber, enemyBreatheFire, getTerrainHeight, shootArrow, shootRock, showNotification]);

  useEffect(() => { gameLoopRef.current = gameLoop; }, [gameLoop]);

  // ============================================================
  // INIT GAME
  // ============================================================
  const initGame = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x4a5568);
    scene.fog = new THREE.FogExp2(fogColor, 0.002); scene.background = fogColor;

    const camera = new THREE.PerspectiveCamera(80, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(0, 25, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Post-processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomEffect = new BloomEffect({ luminanceThreshold: 0.6, luminanceSmoothing: 0.3, intensity: 1.5 });
    composer.addPass(new EffectPass(camera, bloomEffect));
    composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    composer.addPass(new EffectPass(camera, new VignetteEffect({ offset: 0.3, darkness: 0.5 })));

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 0.4); scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
    sunLight.position.set(150, 200, 100); sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 0.5; sunLight.shadow.camera.far = 800;
    sunLight.shadow.camera.left = -300; sunLight.shadow.camera.right = 300;
    sunLight.shadow.camera.top = 300; sunLight.shadow.camera.bottom = -300;
    sunLight.shadow.bias = -0.001; scene.add(sunLight);
    scene.add(new THREE.HemisphereLight(0x88aacc, 0x443322, 0.5));

    // Sun visual
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(15, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffee88 }));
    sunMesh.position.set(600, 400, 150); scene.add(sunMesh);

    // Terrain & structures
    const { terrain, water } = generateTerrain(scene);
    const structures = createStructures(scene);

    // Dragon (procedural fallback)
    const dragonObj = createProceduralDragon(scene);
    const fireLight = dragonObj.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight;

    // Try loading GLB
    let dragonModel: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const loader = new GLTFLoader();
    loader.load('/models/demon_dragon.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(3.5, 3.5, 3.5); // SCALE UP the model significantly
      model.position.copy(dragonObj.position); model.rotation.copy(dragonObj.rotation);
      model.traverse(c => { if (c instanceof THREE.Mesh) { c.castShadow = true; c.receiveShadow = true; } });
      const fl = new THREE.PointLight(0xff4400, 0, 30); fl.position.set(0, 2, -8); model.add(fl);
      scene.remove(dragonObj); scene.add(model);
      if (gltf.animations.length > 0) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations[0]).play(); }
      if (gameRef.current) { gameRef.current.dragon = model; gameRef.current.fireLight = fl; gameRef.current.dragonModel = model; gameRef.current.mixer = mixer; }
    }, undefined, () => console.warn('GLB load failed, using procedural dragon'));

    // Enemies
    const enemies = spawnEnemies(scene);

    // Missions & markers
    const missions = createMissions();
    const missionMarkers = createMissionMarkers(scene, missions);

    // Atmospheric particles
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(1000 * 3);
    for (let i = 0; i < pPos.length; i += 3) { pPos[i] = (Math.random() - 0.5) * 800; pPos[i + 1] = Math.random() * 80 + 5; pPos[i + 2] = (Math.random() - 0.5) * 800; }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.6, transparent: true, opacity: 0.25 })));

    const game = {
      scene, camera, renderer, composer, dragon: dragonObj, clock: new THREE.Clock(),
      keys: new Set<string>(), mouse: { dx: 0, dy: 0, down: false, rightDown: false },
      stats: { health: 150, maxHealth: 150, stamina: 120, maxStamina: 120, hunger: 100, maxHunger: 100, xp: 0, level: 1, xpToNext: 100, territory: 0, gold: 0, breathFuel: 100, maxBreathFuel: 100 },
      enemies, projectiles: [], fireParticles: [], damageNumbers: [], missions, missionIndex: 0,
      isGrounded: true, isFlying: false, isBreathingFire: false, isDiving: false, isSprinting: false,
      diveVelocity: new THREE.Vector3(), dragonVelocity: new THREE.Vector3(), animationId: 0, terrain, water,
      yaw: 0, pitch: 0, wingAngle: 0.3, wingDir: 1,
      hungerTimer: 0, staminaRegenTimer: 0, fireBreathTimer: 0, notificationTimer: 0,
      dragonScale: 1, gameActive: true, dayTime: Math.PI / 3,
      sunLight, sunMesh, ambientLight, fogColor, structures, fireLight,
      dragonModel, mixer, cameraShake: 0, comboCount: 0, comboTimer: 0, killStreak: 0,
      bloomEffect, missionMarkers,
    };

    gameRef.current = game;
    setTimeout(() => { setMissionIndex(0); setCurrentMission(missions[0]); }, 0);

    // ---- Input: Pointer Lock ----
    const canvas = renderer.domElement;

    const requestLock = () => {
      if (!document.pointerLockElement) canvas.requestPointerLock();
    };

    const onPointerLockChange = () => {
      setIsPointerLocked(!!document.pointerLockElement);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        game.mouse.dx += e.movementX;
        game.mouse.dy += e.movementY;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!document.pointerLockElement) { requestLock(); return; }
      if (e.button === 0) game.mouse.down = true;
      if (e.button === 2) game.mouse.rightDown = true;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) game.mouse.down = false;
      if (e.button === 2) game.mouse.rightDown = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      game.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') {
        if (document.pointerLockElement) document.exitPointerLock();
        else setGameState(prev => prev === 'playing' ? 'paused' : 'playing');
      }
      if (e.key === 'Tab') { e.preventDefault(); setShowControls(prev => !prev); }
    };

    const onKeyUp = (e: KeyboardEvent) => game.keys.delete(e.key.toLowerCase());
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      game.camera.aspect = w / h; game.camera.updateProjectionMatrix();
      game.renderer.setSize(w, h); game.composer.setSize(w, h);
    };

    canvas.addEventListener('click', requestLock);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('resize', onResize);

    game.animationId = requestAnimationFrame(() => gameLoopRef.current());

    return () => {
      game.gameActive = false; cancelAnimationFrame(game.animationId);
      if (document.pointerLockElement) document.exitPointerLock();
      canvas.removeEventListener('click', requestLock);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [createMissions, createMissionMarkers, createProceduralDragon, createStructures, generateTerrain, gameLoop, spawnEnemies]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    const cleanup = initGame();
    return cleanup;
  }, [gameState, initGame]);

  if (!mounted) {
    return <div className="w-full h-screen flex items-center justify-center bg-gray-900"><div className="text-center"><h1 className="text-4xl font-bold text-amber-500 mb-4">DRAGON&apos;S REIGN</h1><p className="text-amber-200/60 animate-pulse">Loading...</p></div></div>;
  }

  return (
    <div className="w-full h-screen relative overflow-hidden bg-black" ref={containerRef}>
      {/* MENU */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-gray-950 via-gray-900 to-red-950">
          <div className="text-center">
            <div className="text-8xl mb-4">🐉</div>
            <h1 className="text-7xl font-black text-amber-400 mb-2 tracking-widest" style={{ textShadow: '0 0 60px rgba(217,119,6,0.6)' }}>DRAGON&apos;S REIGN</h1>
            <p className="text-xl text-amber-200/60 mb-1 tracking-wider">MEDIEVAL SURVIVAL</p>
            <p className="text-sm text-gray-500 mb-10">Open World • Deep Survival • Story Campaign</p>
            <button onClick={() => setGameState('playing')} className="px-14 py-5 bg-gradient-to-r from-red-900 to-red-700 hover:from-red-800 hover:to-red-600 text-amber-100 text-2xl font-black rounded-xl border-2 border-amber-500/40 shadow-2xl shadow-red-900/60 transition-all hover:scale-110 mb-8">BEGIN CONQUEST</button>
            <div className="mt-6 text-gray-500 text-xs space-y-1 max-w-lg mx-auto">
              <p>WASD — Move | Space — Fly Up | Shift — Fly Down | E — Sprint</p>
              <p>Mouse — Look Around | Left Click — Fire Breath | Right Click — Dive</p>
              <p>R — Roar Stun | Tab — Controls | Esc — Pause</p>
            </div>
          </div>
        </div>
      )}

      {/* HUD */}
      {gameState === 'playing' && (
        <>
          <div className="absolute top-4 left-4 z-30 space-y-1.5 min-w-[220px]">
            {[
              { label: 'HEALTH', val: stats.health, max: stats.maxHealth, colors: 'from-red-800 to-red-500', border: 'border-red-900/30', text: 'text-red-400' },
              { label: 'STAMINA', val: stats.stamina, max: stats.maxStamina, colors: 'from-yellow-800 to-yellow-400', border: 'border-yellow-900/30', text: 'text-yellow-400' },
              { label: 'HUNGER', val: stats.hunger, max: stats.maxHunger, colors: 'from-green-800 to-green-400', border: 'border-green-900/30', text: 'text-green-400' },
              { label: 'BREATH', val: stats.breathFuel, max: stats.maxBreathFuel, colors: 'from-orange-800 to-orange-400', border: 'border-orange-900/30', text: 'text-orange-400' },
            ].map(s => (
              <div key={s.label} className={`bg-black/70 rounded-lg p-1.5 backdrop-blur-sm ${s.border} border`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`${s.text} text-[10px] font-bold`}>{s.label}</span>
                  <span className={`${s.text} text-[10px] opacity-70`}>{Math.round(s.val)}/{s.max}</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full bg-gradient-to-r ${s.colors} rounded-full transition-all`} style={{ width: `${(s.val / s.max) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="bg-black/70 rounded-lg p-1.5 backdrop-blur-sm border border-amber-900/30">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-amber-400 text-[10px] font-bold">LVL {stats.level}</span>
                <span className="text-amber-300 text-[10px] opacity-70">{stats.xp}/{stats.xpToNext}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-all" style={{ width: `${(stats.xp / stats.xpToNext) * 100}%` }} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="bg-black/70 rounded-lg px-2 py-1 backdrop-blur-sm border border-purple-900/30 flex-1">
                <span className="text-purple-400 text-[9px] font-bold">TERRITORY </span><span className="text-purple-300 text-[9px]">{stats.territory}/8</span>
              </div>
              <div className="bg-black/70 rounded-lg px-2 py-1 backdrop-blur-sm border border-amber-900/30 flex-1">
                <span className="text-amber-400 text-[9px] font-bold">GOLD </span><span className="text-amber-300 text-[9px]">{stats.gold}</span>
              </div>
            </div>
          </div>

          {/* Mission */}
          {currentMission && (
            <div className="absolute top-4 right-4 z-30 max-w-xs">
              <div className="bg-black/70 rounded-lg p-3 backdrop-blur-sm border border-amber-900/30">
                <h3 className="text-amber-400 text-xs font-bold mb-1">MISSION {currentMission.id}: {currentMission.title}</h3>
                <p className="text-gray-300 text-[10px] mb-2">{currentMission.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-[10px]">{currentMission.objective}</span>
                  <span className="text-amber-300 text-xs font-bold">{currentMission.currentCount}/{currentMission.targetCount}</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-all" style={{ width: `${(currentMission.currentCount / currentMission.targetCount) * 100}%` }} />
                </div>
                <p className="text-green-400/80 text-[10px] mt-1">{currentMission.reward}</p>
                <p className="text-amber-200/50 text-[9px] mt-1">📍 Follow the glowing beacon!</p>
              </div>
            </div>
          )}

          {/* Crosshair */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="w-1 h-1 bg-amber-400 rounded-full shadow-lg shadow-amber-400/50" />
          </div>

          {/* Pointer lock prompt */}
          {!isPointerLocked && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40">
              <div className="bg-black/80 text-amber-200 px-8 py-4 rounded-xl text-lg font-bold border border-amber-500/50 backdrop-blur-md cursor-pointer" onClick={() => { /* click on canvas handles it */ }}>
                🖱️ Click to control camera
              </div>
            </div>
          )}

          {notification && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
              <div className="bg-amber-900/80 text-amber-200 px-8 py-4 rounded-xl text-lg font-black border border-amber-500/50 backdrop-blur-md" style={{ textShadow: '0 0 10px rgba(217,119,6,0.5)' }}>{notification}</div>
            </div>
          )}

          {showControls && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
              <div className="bg-black/90 rounded-xl p-6 backdrop-blur-md border border-amber-800/40 min-w-[360px]">
                <h3 className="text-amber-400 text-xl font-black mb-4 text-center">CONTROLS</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[['W', 'Forward'], ['S', 'Backward'], ['A', 'Strafe Left'], ['D', 'Strafe Right'],
                    ['Mouse', 'Look Around'], ['Space', 'Fly Up'], ['Shift', 'Fly Down'], ['E', 'Sprint'],
                    ['LClick', 'Fire Breath'], ['RClick', 'Dive Attack'], ['R', 'Roar Stun'], ['Esc', 'Pause']].map(([k, d]) => (
                    <React.Fragment key={k}><div className="text-gray-400">{k}</div><div className="text-gray-200">{d}</div></React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <div className="bg-black/60 rounded-full px-4 py-1 backdrop-blur-sm border border-gray-700/30">
              <span className="text-xs text-gray-300">{stats.stamina < 10 ? '⚠ EXHAUSTED' : stats.breathFuel < 10 ? '⚠ LOW BREATH' : isPointerLocked ? '⚔ Combat Ready' : '🖱️ Click to control'}</span>
            </div>
          </div>
        </>
      )}

      {/* PAUSE */}
      {gameState === 'paused' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md">
          <h2 className="text-5xl font-black text-amber-400 mb-8">PAUSED</h2>
          <button onClick={() => setGameState('playing')} className="px-10 py-4 bg-red-800 hover:bg-red-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-600/40 transition-all hover:scale-105 mb-4">RESUME</button>
          <button onClick={() => setGameState('menu')} className="px-10 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-lg rounded-xl border border-gray-600/40 transition-all hover:scale-105">MAIN MENU</button>
        </div>
      )}

      {/* GAME OVER */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-black via-red-950/80 to-black">
          <div className="text-7xl mb-4">💀</div>
          <h2 className="text-6xl font-black text-red-500 mb-4">FALLEN</h2>
          <p className="text-gray-400 text-lg mb-2">Your reign has ended.</p>
          <p className="text-amber-400 mb-8">Level {stats.level} | Territory: {stats.territory}/8 | Gold: {stats.gold}</p>
          <button onClick={() => setGameState('menu')} className="px-10 py-4 bg-red-800 hover:bg-red-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-600/40 transition-all hover:scale-105">TRY AGAIN</button>
        </div>
      )}

      {/* VICTORY */}
      {gameState === 'victory' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-amber-950 via-gray-900 to-amber-950">
          <div className="text-7xl mb-4">👑</div>
          <h2 className="text-6xl font-black text-amber-400 mb-4" style={{ textShadow: '0 0 50px rgba(217,119,6,0.6)' }}>KINGDOM CONQUERED</h2>
          <p className="text-amber-200/80 text-lg mb-2">The Dragon King has fallen. You rule the skies.</p>
          <p className="text-amber-400 mb-8">Level {stats.level} | Territory: {stats.territory}/8 | Gold: {stats.gold}</p>
          <button onClick={() => setGameState('menu')} className="px-10 py-4 bg-amber-800 hover:bg-amber-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-500/40 transition-all hover:scale-105">PLAY AGAIN</button>
        </div>
      )}
    </div>
  );
}
