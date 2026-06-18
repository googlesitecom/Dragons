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
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  xp: number;
  level: number;
  xpToNext: number;
  territory: number;
  gold: number;
  breathFuel: number;
  maxBreathFuel: number;
}

interface Mission {
  id: number;
  title: string;
  description: string;
  objective: string;
  targetCount: number;
  currentCount: number;
  completed: boolean;
  reward: string;
}

interface Enemy {
  mesh: THREE.Group;
  type: 'archer' | 'catapult' | 'dragon' | 'knight' | 'boss';
  health: number;
  maxHealth: number;
  speed: number;
  attackCooldown: number;
  attackRange: number;
  damage: number;
  alive: boolean;
  position: THREE.Vector3;
  patrolAngle: number;
  fireTimer: number;
  aggroRange: number;
  stunned: number;
  hitFlash: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  lifetime: number;
  fromEnemy: boolean;
  type: 'arrow' | 'rock' | 'fireball' | 'boulder';
}

interface FireParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
}

interface Territory {
  name: string;
  center: THREE.Vector3;
  radius: number;
  controlled: boolean;
}

interface DamageNumber {
  mesh: THREE.Sprite;
  velocity: THREE.Vector3;
  lifetime: number;
  value: number;
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
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'paused' | 'gameover' | 'victory' | 'loading'>('menu');
  const [stats, setStats] = useState<SurvivalStats>({
    health: 150, maxHealth: 150,
    stamina: 120, maxStamina: 120,
    hunger: 100, maxHunger: 100,
    xp: 0, level: 1, xpToNext: 100,
    territory: 0, gold: 0,
    breathFuel: 100, maxBreathFuel: 100,
  });
  const [currentMission, setCurrentMission] = useState<Mission | null>(null);
  const [missionIndex, setMissionIndex] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [notification, setNotification] = useState<string>('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('Loading assets...');

  const gameRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    dragon: THREE.Group;
    clock: THREE.Clock;
    keys: Set<string>;
    mouse: { x: number; y: number; down: boolean; rightDown: boolean };
    stats: SurvivalStats;
    enemies: Enemy[];
    projectiles: Projectile[];
    fireParticles: FireParticle[];
    damageNumbers: DamageNumber[];
    missions: Mission[];
    missionIndex: number;
    territories: Territory[];
    isGrounded: boolean;
    isFlying: boolean;
    isBreathingFire: boolean;
    isDiving: boolean;
    isSprinting: boolean;
    diveVelocity: THREE.Vector3;
    dragonVelocity: THREE.Vector3;
    animationId: number;
    terrain: THREE.Mesh;
    water: THREE.Mesh;
    yaw: number;
    pitch: number;
    wingAngle: number;
    wingDir: number;
    hungerTimer: number;
    staminaRegenTimer: number;
    fireBreathTimer: number;
    notificationTimer: number;
    dragonScale: number;
    gameActive: boolean;
    dayTime: number;
    sunLight: THREE.DirectionalLight;
    sunMesh: THREE.Mesh;
    ambientLight: THREE.AmbientLight;
    fogColor: THREE.Color;
    structures: THREE.Group[];
    fireLight: THREE.PointLight;
    dragonModel: THREE.Group | null;
    mixer: THREE.AnimationMixer | null;
    cameraShake: number;
    comboCount: number;
    comboTimer: number;
    killStreak: number;
    lastHitTime: number;
    godRayPass: null;
    bloomPass: BloomEffect | null;
  } | null>(null);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    if (gameRef.current) gameRef.current.notificationTimer = 3;
  }, []);

  const createMissions = useCallback((): Mission[] => [
    {
      id: 1, title: 'The Awakening',
      description: 'You have awakened in a hostile kingdom. The archer garrison on the eastern hills has been attacking your kind for centuries. Burn them to ash.',
      objective: 'Destroy the archer garrison', targetCount: 8, currentCount: 0, completed: false,
      reward: '+80 XP, +50 Gold, Fire Breath Upgrade',
    },
    {
      id: 2, title: 'Knight\'s Fall',
      description: 'The king has sent his elite knights to hunt you. Show them the fury of dragonkind.',
      objective: 'Defeat the royal knights', targetCount: 5, currentCount: 0, completed: false,
      reward: '+100 XP, +75 Gold, Stamina Boost',
    },
    {
      id: 3, title: 'Rival Skies',
      description: 'A rival dragon has claimed the northern mountains as its territory. Defeat it to expand your domain.',
      objective: 'Defeat the rival dragon', targetCount: 1, currentCount: 0, completed: false,
      reward: '+150 XP, +100 Gold, Territory Expanded',
    },
    {
      id: 4, title: 'Siege Breaker',
      description: 'The kingdom has deployed catapults along the castle walls. Destroy them before they bring you down.',
      objective: 'Destroy the catapult defenses', targetCount: 4, currentCount: 0, completed: false,
      reward: '+120 XP, +80 Gold, Breath Fuel Upgrade',
    },
    {
      id: 5, title: 'Conquer the Castle',
      description: 'The castle stands as the heart of the kingdom. Claim it by defeating all defenders within its walls.',
      objective: 'Clear the castle defenders', targetCount: 12, currentCount: 0, completed: false,
      reward: '+200 XP, +150 Gold, Castle Territory',
    },
    {
      id: 6, title: 'The Dragon King',
      description: 'The ancient Dragon King, corrupted by dark magic, threatens all life. Only you can end its reign of terror.',
      objective: 'Defeat the Dragon King', targetCount: 1, currentCount: 0, completed: false,
      reward: 'VICTORY — Kingdom Conquered',
    },
  ], []);

  // ============================================================
  // HEIGHTMAP NOISE
  // ============================================================
  const noise2D = useCallback((x: number, z: number): number => {
    // Multi-octave noise for realistic terrain
    let val = 0;
    let amp = 1;
    let freq = 0.008;
    for (let i = 0; i < 6; i++) {
      val += amp * Math.sin(x * freq * 1.7 + z * freq * 0.9 + i * 13.37) *
             Math.cos(z * freq * 1.3 - x * freq * 0.6 + i * 7.13);
      amp *= 0.5;
      freq *= 2.1;
    }
    return val;
  }, []);

  // ============================================================
  // GENERATE AAA TERRAIN
  // ============================================================
  const generateTerrain = useCallback((scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array as Float32Array;
    const colors = new Float32Array(vertices.length);
    const normals = new Float32Array(vertices.length);

    // Biome centers (expanded)
    const lakeCenter = new THREE.Vector2(-200, -120);
    const castleHill = new THREE.Vector2(150, 100);
    const forestCenter = new THREE.Vector2(-100, 200);
    const mountainCenter = new THREE.Vector2(250, -200);
    const villageCenter = new THREE.Vector2(50, -80);
    const swampCenter = new THREE.Vector2(-300, 100);
    const desertCenter = new THREE.Vector2(400, 0);
    const volcanoCenter = new THREE.Vector2(-350, -300);
    const secondForest = new THREE.Vector2(200, 300);
    const ruinsCenter = new THREE.Vector2(-150, -350);

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const z = vertices[i + 2];

      const dLake = Math.sqrt((x - lakeCenter.x) ** 2 + (z - lakeCenter.y) ** 2);
      const dCastle = Math.sqrt((x - castleHill.x) ** 2 + (z - castleHill.y) ** 2);
      const dForest = Math.sqrt((x - forestCenter.x) ** 2 + (z - forestCenter.y) ** 2);
      const dMountain = Math.sqrt((x - mountainCenter.x) ** 2 + (z - mountainCenter.y) ** 2);
      const dVillage = Math.sqrt((x - villageCenter.x) ** 2 + (z - villageCenter.y) ** 2);
      const dSwamp = Math.sqrt((x - swampCenter.x) ** 2 + (z - swampCenter.y) ** 2);
      const dDesert = Math.sqrt((x - desertCenter.x) ** 2 + (z - desertCenter.y) ** 2);
      const dVolcano = Math.sqrt((x - volcanoCenter.x) ** 2 + (z - volcanoCenter.y) ** 2);
      const dForest2 = Math.sqrt((x - secondForest.x) ** 2 + (z - secondForest.y) ** 2);
      const dRuins = Math.sqrt((x - ruinsCenter.x) ** 2 + (z - ruinsCenter.y) ** 2);

      // Base terrain from noise
      let y = noise2D(x, z) * 25;

      // Lake depression
      if (dLake < 140) {
        const f = 1 - dLake / 140;
        y -= f * f * 40;
      }

      // Castle hill
      if (dCastle < 100) {
        const f = 1 - dCastle / 100;
        y += f * f * 50;
      }

      // Mountains - dramatic peaks
      if (dMountain < 200) {
        const f = 1 - dMountain / 200;
        y += f * f * f * 120;
      }

      // Forest gentle hills
      if (dForest < 140) {
        const f = 1 - dForest / 140;
        y += f * 12 + noise2D(x * 2, z * 2) * f * 5;
      }

      // Village flat
      if (dVillage < 80) {
        const f = 1 - dVillage / 80;
        y = y * (1 - f * 0.8);
      }

      // Swamp lowlands
      if (dSwamp < 120) {
        const f = 1 - dSwamp / 120;
        y -= f * 15 + noise2D(x * 3, z * 3) * f * 3;
      }

      // Desert dunes
      if (dDesert < 180) {
        const f = 1 - dDesert / 180;
        y += Math.sin(x * 0.05 + z * 0.02) * f * 15 + noise2D(x * 0.5, z * 0.5) * f * 8;
      }

      // Volcano
      if (dVolcano < 150) {
        const f = 1 - dVolcano / 150;
        y += f * f * 90;
        if (dVolcano < 30) {
          y -= (1 - dVolcano / 30) * 40; // Crater
        }
      }

      // Second forest
      if (dForest2 < 120) {
        const f = 1 - dForest2 / 120;
        y += f * 10 + noise2D(x * 2, z * 2) * f * 4;
      }

      // Ruins area
      if (dRuins < 100) {
        const f = 1 - dRuins / 100;
        y += f * 8;
      }

      vertices[i + 1] = y;

      // AAA Vertex colors with PBR-ready values
      let r = 0.22, g = 0.38, b = 0.12; // Default grass

      if (dLake < 145) {
        if (y < WATER_LEVEL + 3) {
          r = 0.06; g = 0.15; b = 0.30; // Deep water
        } else if (y < WATER_LEVEL + 8) {
          const t = (y - WATER_LEVEL - 3) / 5;
          r = 0.55 + t * 0.1; g = 0.50 + t * 0.05; b = 0.30; // Sand
        }
      }

      if (dMountain < 200 && y > 20) {
        const t = Math.min(1, (y - 20) / 60);
        if (y > 70) {
          r = 0.92; g = 0.92; b = 0.95; // Snow
        } else if (y > 45) {
          const s = (y - 45) / 25;
          r = 0.55 + s * 0.37; g = 0.52 + s * 0.40; b = 0.50 + s * 0.45; // Rock to snow
        } else {
          r = 0.38; g = 0.35; b = 0.30; // Rock
        }
      }

      if ((dForest < 140 || dForest2 < 120) && y > WATER_LEVEL + 3) {
        const f = Math.max(0, 1 - Math.min(dForest, dForest2) / 140);
        r = 0.08 + f * 0.04; g = 0.25 + f * 0.12; b = 0.05; // Deep forest green
      }

      if (dVillage < 80 && y > WATER_LEVEL + 3) {
        const f = Math.max(0, 1 - dVillage / 80);
        r = 0.45 + f * 0.08; g = 0.40 + f * 0.05; b = 0.28; // Village dirt
      }

      if (dSwamp < 120 && y > WATER_LEVEL - 2) {
        const f = Math.max(0, 1 - dSwamp / 120);
        r = 0.15 + f * 0.05; g = 0.22 + f * 0.08; b = 0.08 + f * 0.03; // Swamp murk
      }

      if (dDesert < 180) {
        const f = Math.max(0, 1 - dDesert / 180);
        r = 0.76 + f * 0.08; g = 0.65 + f * 0.06; b = 0.40 + f * 0.04; // Desert sand
      }

      if (dVolcano < 150) {
        const f = Math.max(0, 1 - dVolcano / 150);
        if (dVolcano < 30) {
          r = 0.15; g = 0.05; b = 0.02; // Lava crater
        } else {
          r = 0.30 + f * 0.1; g = 0.20 + f * 0.05; b = 0.12 + f * 0.03; // Volcanic rock
        }
      }

      if (dRuins < 100 && y > WATER_LEVEL + 3) {
        const f = Math.max(0, 1 - dRuins / 100);
        r = 0.35 + f * 0.08; g = 0.32 + f * 0.05; b = 0.28 + f * 0.03; // Ancient stone
      }

      colors[i] = r;
      colors[i + 1] = g;
      colors[i + 2] = b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // AAA terrain material with tessellation-like detail
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.03,
      flatShading: false,
      envMapIntensity: 0.5,
    });

    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    scene.add(terrain);

    // Water with realistic shader
    const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE * 1.2, TERRAIN_SIZE * 1.2, 64, 64);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0a3d5c,
      transparent: true,
      opacity: 0.75,
      roughness: 0.05,
      metalness: 0.6,
      envMapIntensity: 1.0,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = WATER_LEVEL;
    water.receiveShadow = true;
    scene.add(water);

    // Lava in volcano crater
    const lavaGeo = new THREE.CircleGeometry(25, 32);
    lavaGeo.rotateX(-Math.PI / 2);
    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff2200,
      emissiveIntensity: 2,
      roughness: 0.3,
      metalness: 0.1,
    });
    const lava = new THREE.Mesh(lavaGeo, lavaMat);
    lava.position.set(-350, 48, -300);
    scene.add(lava);

    const lavaLight = new THREE.PointLight(0xff4400, 5, 80);
    lavaLight.position.set(-350, 55, -300);
    scene.add(lavaLight);

    return { terrain, water };
  }, [noise2D]);

  // ============================================================
  // CREATE AAA STRUCTURES
  // ============================================================
  const createStructures = useCallback((scene: THREE.Scene) => {
    const structures: THREE.Group[] = [];

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.85, metalness: 0.1 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x454545, roughness: 0.8, metalness: 0.15 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a3b10, roughness: 0.9, metalness: 0.0 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7, metalness: 0.05 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xdaa520, roughness: 0.3, metalness: 0.8 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.4, metalness: 0.7 });

    // ---- GRAND CASTLE ----
    const castle = new THREE.Group();
    // Main keep
    const keepGeo = new THREE.BoxGeometry(25, 35, 25);
    const keep = new THREE.Mesh(keepGeo, darkStoneMat);
    keep.position.set(150, 57, 100);
    keep.castShadow = true;
    keep.receiveShadow = true;
    castle.add(keep);

    // Keep windows (emissive)
    const windowMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xffaa22, emissiveIntensity: 0.8, roughness: 0.3 });
    for (let row = 0; row < 3; row++) {
      for (let col = -1; col <= 1; col += 2) {
        const winGeo = new THREE.BoxGeometry(2, 3, 0.3);
        const win = new THREE.Mesh(winGeo, windowMat);
        win.position.set(150 + col * 6, 50 + row * 8, 87.5);
        castle.add(win);
      }
    }

    // Keep top with gold trim
    const keepTopGeo = new THREE.ConeGeometry(18, 10, 4);
    const keepTop = new THREE.Mesh(keepTopGeo, roofMat);
    keepTop.position.set(150, 80, 100);
    keepTop.rotation.y = Math.PI / 4;
    keepTop.castShadow = true;
    castle.add(keepTop);

    // Gold crown on keep
    const crownGeo = new THREE.TorusGeometry(4, 0.5, 8, 6);
    const crown = new THREE.Mesh(crownGeo, goldMat);
    crown.position.set(150, 86, 100);
    crown.rotation.x = Math.PI / 2;
    castle.add(crown);

    // Extended walls with battlements
    const wallDefs = [
      { x: 125, z: 75, w: 50, h: 16, d: 4 },
      { x: 175, z: 75, w: 50, h: 16, d: 4 },
      { x: 100, z: 100, w: 4, h: 16, d: 50 },
      { x: 200, z: 100, w: 4, h: 16, d: 50 },
    ];
    wallDefs.forEach(wp => {
      const wallGeo = new THREE.BoxGeometry(wp.w, wp.h, wp.d);
      const wall = new THREE.Mesh(wallGeo, stoneMat);
      wall.position.set(wp.x, wp.h / 2 + 38, wp.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      castle.add(wall);

      // Battlements
      for (let b = -wp.w / 2 + 2; b < wp.w / 2; b += 4) {
        const batGeo = new THREE.BoxGeometry(2, 3, wp.d + 1);
        const bat = new THREE.Mesh(batGeo, stoneMat);
        bat.position.set(wp.x + b, wp.h + 1.5 + 38, wp.z);
        bat.castShadow = true;
        castle.add(bat);
      }
    });

    // 6 Corner towers
    const towerPos = [
      { x: 125, z: 75 }, { x: 175, z: 75 },
      { x: 125, z: 125 }, { x: 175, z: 125 },
      { x: 100, z: 75 }, { x: 200, z: 125 },
    ];
    towerPos.forEach(tp => {
      const tGeo = new THREE.CylinderGeometry(4, 5, 24, 8);
      const tower = new THREE.Mesh(tGeo, darkStoneMat);
      tower.position.set(tp.x, 50, tp.z);
      tower.castShadow = true;
      castle.add(tower);

      const tTopGeo = new THREE.ConeGeometry(5.5, 8, 8);
      const tTop = new THREE.Mesh(tTopGeo, roofMat);
      tTop.position.set(tp.x, 66, tp.z);
      tTop.castShadow = true;
      castle.add(tTop);

      // Tower window
      const tWin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.3), windowMat);
      tWin.position.set(tp.x, 56, tp.z < 100 ? tp.z - 4.5 : tp.z + 4.5);
      castle.add(tWin);
    });

    // Gate with portcullis
    const gateGeo = new THREE.BoxGeometry(12, 14, 4);
    const gate = new THREE.Mesh(gateGeo, ironMat);
    gate.position.set(150, 45, 75);
    castle.add(gate);

    // Gate arch
    const archGeo = new THREE.TorusGeometry(7, 1, 8, 16, Math.PI);
    const arch = new THREE.Mesh(archGeo, stoneMat);
    arch.position.set(150, 52, 73);
    castle.add(arch);

    // Castle courtyard lights
    for (let i = 0; i < 4; i++) {
      const torchLight = new THREE.PointLight(0xff8833, 2, 25);
      torchLight.position.set(130 + i * 15, 50, 95);
      castle.add(torchLight);
    }

    scene.add(castle);
    structures.push(castle);

    // ---- VILLAGE (expanded) ----
    const village = new THREE.Group();
    const housePositions = [
      { x: 30, z: -60 }, { x: 45, z: -50 }, { x: 20, z: -75 },
      { x: 55, z: -65 }, { x: 35, z: -85 }, { x: 60, z: -80 },
      { x: 25, z: -45 }, { x: 50, z: -40 }, { x: 70, z: -55 },
      { x: 40, z: -95 }, { x: 15, z: -55 }, { x: 65, z: -70 },
    ];
    housePositions.forEach(hp => {
      const house = new THREE.Group();
      const w = 5 + Math.random() * 4;
      const h = 4 + Math.random() * 2;
      const d = 5 + Math.random() * 4;
      const wallGeo = new THREE.BoxGeometry(w, h, d);
      const wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.35 + Math.random() * 0.15, 0.25 + Math.random() * 0.1, 0.12),
        roughness: 0.9,
      }));
      wall.position.y = h / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      house.add(wall);

      // Roof
      const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.7, 4, 4);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = h + 2;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      house.add(roof);

      // Door
      const doorGeo = new THREE.BoxGeometry(1.2, 2, 0.2);
      const door = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x3a1a00, roughness: 0.8 }));
      door.position.set(0, 1, d / 2 + 0.1);
      house.add(door);

      // Window with light
      const hWin = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 0.2), windowMat);
      hWin.position.set(w / 3, h * 0.65, d / 2 + 0.1);
      house.add(hWin);

      house.position.set(hp.x, 0, hp.z);
      house.rotation.y = Math.random() * 0.4 - 0.2;
      village.add(house);
    });

    // Church
    const churchGeo = new THREE.BoxGeometry(10, 10, 16);
    const church = new THREE.Mesh(churchGeo, stoneMat);
    church.position.set(42, 5, -68);
    church.castShadow = true;
    village.add(church);
    const steepleGeo = new THREE.ConeGeometry(4, 12, 4);
    const steeple = new THREE.Mesh(steepleGeo, roofMat);
    steeple.position.set(42, 16, -68);
    steeple.castShadow = true;
    village.add(steeple);
    // Cross
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), goldMat);
    crossV.position.set(42, 23, -68);
    village.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 0.3), goldMat);
    crossH.position.set(42, 23.5, -68);
    village.add(crossH);

    // Market stalls
    for (let i = 0; i < 5; i++) {
      const stall = new THREE.Group();
      const stallBase = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 2), woodMat);
      stallBase.position.y = 0.5;
      stall.add(stallBase);
      const stallRoof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 3), new THREE.MeshStandardMaterial({
        color: [0xcc3333, 0x3333cc, 0x33cc33, 0xcccc33, 0xcc33cc][i],
        roughness: 0.7,
      }));
      stallRoof.position.y = 2.5;
      stall.add(stallRoof);
      // Poles
      for (const px of [-1.3, 1.3]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.5), woodMat);
        pole.position.set(px, 1.25, 0);
        stall.add(pole);
      }
      stall.position.set(48 + i * 5, 0, -50);
      village.add(stall);
    }

    // Village well
    const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 1.5, 12), stoneMat);
    wellBase.position.set(40, 0.75, -55);
    village.add(wellBase);
    const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(3, 3, 4), woodMat);
    wellRoof.position.set(40, 4.5, -55);
    village.add(wellRoof);

    scene.add(village);
    structures.push(village);

    // ---- DENSE FORESTS ----
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x1a4d0a, roughness: 0.75, metalness: 0.0 });
    const darkTreeMat = new THREE.MeshStandardMaterial({ color: 0x0f3305, roughness: 0.8 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a1f08, roughness: 0.95 });
    const autumnTreeMat = new THREE.MeshStandardMaterial({ color: 0xcc6600, roughness: 0.7 });

    const forestCenters = [
      { cx: -100, cz: 200, count: 250, mat: treeMat },
      { cx: 200, cz: 300, count: 150, mat: darkTreeMat },
      { cx: -200, cz: -200, count: 100, mat: autumnTreeMat },
    ];

    forestCenters.forEach(fc => {
      const forest = new THREE.Group();
      for (let i = 0; i < fc.count; i++) {
        const tree = new THREE.Group();
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 120;
        const tx = fc.cx + Math.cos(angle) * dist;
        const tz = fc.cz + Math.sin(angle) * dist;

        const trunkH = 5 + Math.random() * 6;
        const trunkGeo = new THREE.CylinderGeometry(0.3 + Math.random() * 0.2, 0.5 + Math.random() * 0.3, trunkH, 6);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        tree.add(trunk);

        const leafSize = 2.5 + Math.random() * 3;
        // Multiple leaf layers for AAA look
        for (let l = 0; l < 3; l++) {
          const lSize = leafSize * (1 - l * 0.25);
          const leavesGeo = new THREE.ConeGeometry(lSize, lSize * 1.5, 7);
          const leaves = new THREE.Mesh(leavesGeo, l === 0 ? fc.mat : (l === 1 ? treeMat : darkTreeMat));
          leaves.position.y = trunkH + l * leafSize * 0.8 + leafSize * 0.5;
          leaves.castShadow = true;
          leaves.receiveShadow = true;
          tree.add(leaves);
        }

        tree.position.set(tx, 0, tz);
        forest.add(tree);
      }
      scene.add(forest);
      structures.push(forest);
    });

    // ---- RUINS ----
    const ruins = new THREE.Group();
    const ruinPositions = [
      { x: -150, z: -350 }, { x: -130, z: -340 }, { x: -170, z: -360 },
      { x: -140, z: -330 }, { x: -160, z: -370 },
    ];
    ruinPositions.forEach(rp => {
      const h = 5 + Math.random() * 10;
      const pillarGeo = new THREE.CylinderGeometry(0.8, 1.0, h, 8);
      const pillar = new THREE.Mesh(pillarGeo, new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 }));
      pillar.position.set(rp.x, h / 2, rp.z);
      pillar.rotation.z = Math.random() * 0.2 - 0.1;
      pillar.castShadow = true;
      ruins.add(pillar);

      // Fallen blocks
      const blockGeo = new THREE.BoxGeometry(2 + Math.random() * 3, 1.5, 2 + Math.random() * 2);
      const block = new THREE.Mesh(blockGeo, stoneMat);
      block.position.set(rp.x + 5 + Math.random() * 3, 0.75, rp.z + 3 + Math.random() * 3);
      block.rotation.y = Math.random() * Math.PI;
      block.castShadow = true;
      ruins.add(block);
    });

    // Ancient altar
    const altarGeo = new THREE.BoxGeometry(4, 1, 3);
    const altar = new THREE.Mesh(altarGeo, darkStoneMat);
    altar.position.set(-150, 0.5, -350);
    ruins.add(altar);
    const orbGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0x6633ff, emissive: 0x4411cc, emissiveIntensity: 2, roughness: 0.1, metalness: 0.9 });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(-150, 2, -350);
    ruins.add(orb);
    const orbLight = new THREE.PointLight(0x6633ff, 3, 20);
    orbLight.position.set(-150, 3, -350);
    ruins.add(orbLight);

    scene.add(ruins);
    structures.push(ruins);

    // ---- BRIDGES ----
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.85 });
    // Bridge near village
    const bridge1 = new THREE.Group();
    const bDeck = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 20), bridgeMat);
    bDeck.position.set(10, WATER_LEVEL + 1, -70);
    bridge1.add(bDeck);
    for (const bx of [-3.5, 3.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 20), bridgeMat);
      rail.position.set(bx, WATER_LEVEL + 2, -70);
      bridge1.add(rail);
    }
    scene.add(bridge1);
    structures.push(bridge1);

    // ---- WATCHTOWERS scattered ----
    const watchPositions = [
      { x: 200, z: 0 }, { x: -200, z: 0 },
      { x: 0, z: 250 }, { x: 0, z: -250 },
      { x: 300, z: -100 },
    ];
    watchPositions.forEach(wp => {
      const tower = new THREE.Group();
      const tGeo = new THREE.CylinderGeometry(2.5, 3, 15, 8);
      const t = new THREE.Mesh(tGeo, stoneMat);
      t.position.y = 7.5;
      t.castShadow = true;
      tower.add(t);
      const tTop = new THREE.Mesh(new THREE.ConeGeometry(3.5, 5, 8), roofMat);
      tTop.position.y = 17.5;
      tTop.castShadow = true;
      tower.add(tTop);
      // Fire brazier on top
      const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.8, 8), ironMat);
      brazier.position.y = 14;
      tower.add(brazier);
      const fireLight = new THREE.PointLight(0xff6622, 3, 30);
      fireLight.position.y = 15;
      tower.add(fireLight);
      tower.position.set(wp.x, 0, wp.z);
      scene.add(tower);
      structures.push(tower);
    });

    // ---- CATAPULT POSITIONS (barricades) ----
    const barricadePositions = [
      { x: 180, z: 60 }, { x: 120, z: 55 },
    ];
    barricadePositions.forEach(bp => {
      const barricade = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const logGeo = new THREE.CylinderGeometry(0.2, 0.25, 4, 6);
        const log = new THREE.Mesh(logGeo, woodMat);
        log.position.set(i * 0.8 - 2, 2, 0);
        log.rotation.z = Math.random() * 0.3 - 0.15;
        log.castShadow = true;
        barricade.add(log);
      }
      barricade.position.set(bp.x, 0, bp.z);
      scene.add(barricade);
    });

    return structures;
  }, []);

  // ============================================================
  // CREATE PROCEDURAL DRAGON (fallback)
  // ============================================================
  const createProceduralDragon = useCallback((scene: THREE.Scene) => {
    const dragon = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2d1b0e, roughness: 0.5, metalness: 0.4 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6, metalness: 0.2 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 3 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.3, metalness: 0.5 });
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.4, metalness: 0.4 });

    // Body
    const bodyGeo = new THREE.SphereGeometry(1.5, 12, 8);
    bodyGeo.scale(1, 0.7, 1.8);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    dragon.add(body);

    const bellyGeo = new THREE.SphereGeometry(1.2, 10, 8);
    bellyGeo.scale(0.8, 0.5, 1.5);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, -0.3, 0);
    dragon.add(belly);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.5, 0.8, 2, 8);
    const neck = new THREE.Mesh(neckGeo, bodyMat);
    neck.position.set(0, 0.5, -2);
    neck.rotation.x = -0.4;
    neck.castShadow = true;
    dragon.add(neck);

    // Head
    const headGeo = new THREE.SphereGeometry(0.7, 10, 8);
    headGeo.scale(0.8, 0.7, 1.2);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 1.2, -3.2);
    head.castShadow = true;
    dragon.add(head);

    // Snout
    const snoutGeo = new THREE.ConeGeometry(0.4, 1.2, 8);
    const snout = new THREE.Mesh(snoutGeo, bodyMat);
    snout.position.set(0, 1.0, -4.2);
    snout.rotation.x = Math.PI / 2;
    dragon.add(snout);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.15, 12, 12);
    [-0.4, 0.4].forEach(x => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, 1.5, -3.5);
      dragon.add(eye);
    });

    // Horns
    const hornGeo = new THREE.ConeGeometry(0.15, 1.5, 6);
    [[-0.4, 0.3], [0.4, -0.3]].forEach(([x, rz]) => {
      const horn = new THREE.Mesh(hornGeo, hornMat);
      horn.position.set(x as number, 2.0, -3.0);
      horn.rotation.x = -0.3;
      horn.rotation.z = rz as number;
      horn.castShadow = true;
      dragon.add(horn);
    });

    // Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1, 0.5);
    wingShape.lineTo(3, 2);
    wingShape.lineTo(4.5, 1.8);
    wingShape.lineTo(4, 0.8);
    wingShape.lineTo(2.5, -0.2);
    wingShape.lineTo(0.5, -0.5);
    wingShape.lineTo(0, 0);
    const wingGeo = new THREE.ShapeGeometry(wingShape);

    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(1, 0.3, -0.5);
    leftWing.rotation.y = Math.PI / 2;
    leftWing.rotation.z = 0.3;
    leftWing.name = 'leftWing';
    dragon.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(-1, 0.3, -0.5);
    rightWing.rotation.y = -Math.PI / 2;
    rightWing.rotation.z = -0.3;
    rightWing.name = 'rightWing';
    dragon.add(rightWing);

    // Wing bones
    const boneGeo = new THREE.CylinderGeometry(0.06, 0.1, 4, 4);
    const boneMat2 = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.5, metalness: 0.3 });
    [[2.8, Math.PI / 4], [-2.8, -Math.PI / 4]].forEach(([x, rz]) => {
      const bone = new THREE.Mesh(boneGeo, boneMat2);
      bone.position.set(x as number, 1.0, -0.3);
      bone.rotation.z = rz as number;
      dragon.add(bone);
    });

    // Tail
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      const radius = 0.6 * (1 - t * 0.85);
      const segGeo = new THREE.SphereGeometry(radius, 6, 4);
      const seg = new THREE.Mesh(segGeo, bodyMat);
      seg.position.set(0, -0.2 + t * 0.5, 1.5 + i * 0.8);
      seg.castShadow = true;
      dragon.add(seg);
    }

    // Tail spike
    const tailSpikeGeo = new THREE.ConeGeometry(0.3, 1.2, 6);
    const tailSpike = new THREE.Mesh(tailSpikeGeo, spikeMat);
    tailSpike.position.set(0, 1.8, 1.5 + 10 * 0.8);
    tailSpike.rotation.x = Math.PI / 2;
    dragon.add(tailSpike);

    // Back spikes
    for (let i = 0; i < 8; i++) {
      const sGeo = new THREE.ConeGeometry(0.12, 0.6, 4);
      const spike = new THREE.Mesh(sGeo, spikeMat);
      spike.position.set(0, 1.1 - i * 0.04, -1.8 + i * 0.5);
      dragon.add(spike);
    }

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.8, 6);
    const clawGeo = new THREE.ConeGeometry(0.3, 0.5, 4);
    [{ x: 0.9, z: -0.5 }, { x: -0.9, z: -0.5 }, { x: 0.9, z: 1.2 }, { x: -0.9, z: 1.2 }].forEach(lp => {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(lp.x, -1.1, lp.z);
      leg.castShadow = true;
      dragon.add(leg);
      const claw = new THREE.Mesh(clawGeo, bodyMat);
      claw.position.set(lp.x, -2.1, lp.z);
      claw.rotation.x = Math.PI;
      dragon.add(claw);
    });

    // Fire light
    const fireLight = new THREE.PointLight(0xff4400, 0, 25);
    fireLight.position.set(0, 1.0, -4.5);
    dragon.add(fireLight);

    dragon.position.set(0, 20, 0);
    dragon.castShadow = true;
    scene.add(dragon);

    return dragon;
  }, []);

  // ============================================================
  // CREATE ENEMY
  // ============================================================
  const createEnemyMesh = useCallback((type: string, position: THREE.Vector3) => {
    const group = new THREE.Group();

    if (type === 'archer') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7, metalness: 0.3 });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xc4956a, roughness: 0.6 });
      const bowMat = new THREE.MeshStandardMaterial({ color: 0x6B3410, roughness: 0.5 });

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.6, 8), bodyMat);
      body.position.y = 0.8;
      body.castShadow = true;
      group.add(body);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), skinMat);
      head.position.y = 1.9;
      head.castShadow = true;
      group.add(head);

      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.33, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.3 }));
      helmet.position.y = 2.0;
      group.add(helmet);

      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 12, Math.PI), bowMat);
      bow.position.set(0.5, 1.3, 0);
      bow.rotation.z = Math.PI / 2;
      group.add(bow);

      group.position.copy(position);
      return { mesh: group, health: 35, speed: 2.5, attackCooldown: 1.8, attackRange: 100, damage: 10, aggroRange: 120 };
    }

    if (type === 'knight') {
      const armorMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.3 });
      const goldTrim = new THREE.MeshStandardMaterial({ color: 0xdaa520, metalness: 0.9, roughness: 0.2 });

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.8, 8), armorMat);
      body.position.y = 0.9;
      body.castShadow = true;
      group.add(body);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), armorMat);
      head.position.y = 2.1;
      head.castShadow = true;
      group.add(head);

      // Helmet visor
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.35), goldTrim);
      visor.position.set(0, 2.1, 0.2);
      group.add(visor);

      // Sword
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 }));
      blade.position.set(0.6, 1.2, 0);
      blade.rotation.z = -0.3;
      group.add(blade);
      const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), goldTrim);
      hilt.position.set(0.5, 0.4, 0);
      group.add(hilt);

      // Shield
      const shield = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), armorMat);
      shield.position.set(-0.5, 1.2, 0.3);
      shield.rotation.y = 0.3;
      group.add(shield);

      group.position.copy(position);
      return { mesh: group, health: 80, speed: 3.5, attackCooldown: 2.5, attackRange: 30, damage: 18, aggroRange: 60 };
    }

    if (type === 'catapult') {
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a2d0c, roughness: 0.8 });
      const metalMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.4 });

      const base = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 2.5), woodMat);
      base.position.y = 0.6;
      base.castShadow = true;
      group.add(base);

      [-1.5, 1.5].forEach(x => {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.2, 8, 16), woodMat);
        wheel.position.set(x, 0.6, 1.5);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      });

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5, 0.35), woodMat);
      arm.position.set(0, 3, -0.5);
      arm.rotation.x = -0.5;
      arm.castShadow = true;
      group.add(arm);

      const bucket = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1), metalMat);
      bucket.position.set(0, 5, -2);
      group.add(bucket);

      group.position.copy(position);
      return { mesh: group, health: 100, speed: 0, attackCooldown: 3.5, attackRange: 150, damage: 30, aggroRange: 160 };
    }

    if (type === 'dragon') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.45, metalness: 0.4 });
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x5a0000, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3 });

      const body = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8).scale(1, 0.7, 1.8) as THREE.BufferGeometry, bodyMat);
      body.castShadow = true;
      group.add(body);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8).scale(0.8, 0.7, 1.2) as THREE.BufferGeometry, bodyMat);
      head.position.set(0, 0.8, -3.8);
      head.castShadow = true;
      group.add(head);

      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 8), bodyMat);
      snout.position.set(0, 0.6, -5);
      snout.rotation.x = Math.PI / 2;
      group.add(snout);

      [-0.5, 0.5].forEach(x => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), eyeMat);
        eye.position.set(x, 1.3, -4);
        group.add(eye);
      });

      const ws = new THREE.Shape();
      ws.moveTo(0, 0); ws.lineTo(1, 0.5); ws.lineTo(4, 2.5); ws.lineTo(6, 2);
      ws.lineTo(5, 0.8); ws.lineTo(2.5, -0.3); ws.lineTo(0.5, -0.5); ws.lineTo(0, 0);
      const wGeo = new THREE.ShapeGeometry(ws);

      const lw = new THREE.Mesh(wGeo, wingMat);
      lw.position.set(1.5, 0.5, -0.5);
      lw.rotation.y = Math.PI / 2;
      lw.name = 'leftWing';
      group.add(lw);

      const rw = new THREE.Mesh(wGeo, wingMat);
      rw.position.set(-1.5, 0.5, -0.5);
      rw.rotation.y = -Math.PI / 2;
      rw.name = 'rightWing';
      group.add(rw);

      for (let i = 0; i < 7; i++) {
        const t = i / 7;
        const r = 0.8 * (1 - t * 0.8);
        const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), bodyMat);
        seg.position.set(0, -0.2 + t * 0.3, 1.5 + i * 1.1);
        group.add(seg);
      }

      const fLight = new THREE.PointLight(0xff0000, 0, 20);
      fLight.position.set(0, 0.8, -5.5);
      group.add(fLight);

      group.position.copy(position);
      const isBoss = position.y > 35;
      return {
        mesh: group,
        health: isBoss ? 500 : 150,
        speed: isBoss ? 14 : 10,
        attackCooldown: isBoss ? 1.2 : 2.2,
        attackRange: isBoss ? 70 : 55,
        damage: isBoss ? 28 : 15,
        aggroRange: isBoss ? 200 : 120,
      };
    }

    return { mesh: group, health: 50, speed: 3, attackCooldown: 2, attackRange: 50, damage: 10, aggroRange: 80 };
  }, []);

  // ============================================================
  // SPAWN ENEMIES
  // ============================================================
  const spawnEnemies = useCallback((scene: THREE.Scene) => {
    const enemies: Enemy[] = [];

    // Mission 1: Archers on eastern hills
    for (let i = 0; i < 8; i++) {
      const pos = new THREE.Vector3(250 + Math.random() * 60, 12 + Math.random() * 5, -50 + Math.random() * 40);
      const data = createEnemyMesh('archer', pos);
      scene.add(data.mesh);
      enemies.push({ ...data, type: 'archer', maxHealth: data.health, alive: true, position: pos.clone(), patrolAngle: Math.random() * 6.28, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }

    // Mission 2: Knights
    for (let i = 0; i < 5; i++) {
      const pos = new THREE.Vector3(50 + Math.random() * 30, 0, -60 + Math.random() * 20);
      const data = createEnemyMesh('knight', pos);
      scene.add(data.mesh);
      enemies.push({ ...data, type: 'knight', maxHealth: data.health, alive: true, position: pos.clone(), patrolAngle: Math.random() * 6.28, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }

    // Mission 3: Rival dragon
    const rivalPos = new THREE.Vector3(250, 45, -200);
    const rivalData = createEnemyMesh('dragon', rivalPos);
    scene.add(rivalData.mesh);
    enemies.push({ ...rivalData, type: 'dragon', maxHealth: rivalData.health, alive: true, position: rivalPos.clone(), patrolAngle: 0, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: rivalData.aggroRange });

    // Mission 4: Catapults
    const catPos = [
      new THREE.Vector3(185, 35, 75), new THREE.Vector3(115, 35, 80),
      new THREE.Vector3(150, 35, 130), new THREE.Vector3(170, 35, 120),
    ];
    catPos.forEach(pos => {
      const data = createEnemyMesh('catapult', pos);
      scene.add(data.mesh);
      enemies.push({ ...data, type: 'catapult', maxHealth: data.health, alive: true, position: pos.clone(), patrolAngle: 0, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    });

    // Mission 5: Castle defenders (archers + knights)
    for (let i = 0; i < 12; i++) {
      const isKnight = i < 4;
      const pos = isKnight
        ? new THREE.Vector3(140 + Math.random() * 20, 40, 90 + Math.random() * 15)
        : new THREE.Vector3(130 + Math.random() * 40, 55 + Math.random() * 5, 80 + Math.random() * 40);
      const type = isKnight ? 'knight' : 'archer';
      const data = createEnemyMesh(type, pos);
      scene.add(data.mesh);
      enemies.push({ ...data, type: type as 'archer' | 'knight', maxHealth: data.health, alive: true, position: pos.clone(), patrolAngle: Math.random() * 6.28, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }

    // Mission 6: Dragon King Boss
    const kingPos = new THREE.Vector3(0, 55, 0);
    const kingData = createEnemyMesh('dragon', kingPos);
    kingData.mesh.scale.set(2.5, 2.5, 2.5);
    scene.add(kingData.mesh);
    enemies.push({ ...kingData, type: 'boss', maxHealth: kingData.health, alive: true, position: kingPos.clone(), patrolAngle: 0, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: kingData.aggroRange });

    // Extra patrol enemies
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const pos = new THREE.Vector3(Math.cos(angle) * 200, 0, Math.sin(angle) * 200);
      const data = createEnemyMesh('archer', pos);
      scene.add(data.mesh);
      enemies.push({ ...data, type: 'archer', maxHealth: data.health, alive: true, position: pos.clone(), patrolAngle: angle, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }

    return enemies;
  }, [createEnemyMesh]);

  // ============================================================
  // GET TERRAIN HEIGHT
  // ============================================================
  const getTerrainHeight = useCallback((x: number, z: number, terrain: THREE.Mesh): number => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(terrain);
    return hits.length > 0 ? hits[0].point.y : 0;
  }, []);

  // ============================================================
  // FIRE BREATH
  // ============================================================
  const breatheFire = useCallback(() => {
    const game = gameRef.current;
    if (!game || game.stats.stamina < 3 || game.stats.breathFuel < 1) return;

    game.stats.stamina -= 3;
    game.stats.breathFuel -= 2;
    game.isBreathingFire = true;
    game.fireLight.intensity = 5;

    const dragonDir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.dragon.quaternion);
    const dragonPos = game.dragon.position.clone().add(dragonDir.clone().multiplyScalar(4));
    dragonPos.y += 1;

    for (let i = 0; i < 8; i++) {
      const size = 0.3 + Math.random() * 0.5;
      const fireGeo = new THREE.SphereGeometry(size, 6, 6);
      const hue = 0.04 + Math.random() * 0.08;
      const fireMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue, 1, 0.5 + Math.random() * 0.4),
        transparent: true, opacity: 0.95,
      });
      const fireMesh = new THREE.Mesh(fireGeo, fireMat);
      fireMesh.position.copy(dragonPos);

      const spread = 0.35;
      const vel = dragonDir.clone().multiplyScalar(40 + Math.random() * 25);
      vel.x += (Math.random() - 0.5) * spread * 35;
      vel.y += (Math.random() - 0.5) * spread * 25;
      vel.z += (Math.random() - 0.5) * spread * 35;

      game.scene.add(fireMesh);
      game.fireParticles.push({ mesh: fireMesh, velocity: vel, lifetime: 0.6 + Math.random() * 0.5, maxLifetime: 1.1 });
    }
  }, []);

  // ============================================================
  // ENEMY ATTACKS
  // ============================================================
  const enemyBreatheFire = useCallback((enemy: Enemy) => {
    const game = gameRef.current;
    if (!game) return;
    const dir = new THREE.Vector3().subVectors(game.dragon.position, enemy.mesh.position).normalize();
    const pos = enemy.mesh.position.clone().add(dir.clone().multiplyScalar(3));
    pos.y += 0.8;

    for (let i = 0; i < 5; i++) {
      const fireGeo = new THREE.SphereGeometry(0.35 + Math.random() * 0.25, 5, 5);
      const fireMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.02 + Math.random() * 0.04, 1, 0.5 + Math.random() * 0.3),
        transparent: true, opacity: 0.9,
      });
      const mesh = new THREE.Mesh(fireGeo, fireMat);
      mesh.position.copy(pos);
      const vel = dir.clone().multiplyScalar(28 + Math.random() * 18);
      vel.x += (Math.random() - 0.5) * 12;
      vel.y += (Math.random() - 0.5) * 10;
      vel.z += (Math.random() - 0.5) * 12;
      game.scene.add(mesh);
      game.fireParticles.push({ mesh, velocity: vel, lifetime: 0.7 + Math.random() * 0.3, maxLifetime: 1.0 });
    }
  }, []);

  const shootArrow = useCallback((enemy: Enemy) => {
    const game = gameRef.current;
    if (!game) return;
    const dir = new THREE.Vector3().subVectors(game.dragon.position, enemy.mesh.position).normalize();
    const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4);
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.5 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.copy(enemy.mesh.position);
    arrow.position.y += 2;
    arrow.lookAt(game.dragon.position);
    arrow.rotateX(Math.PI / 2);
    game.scene.add(arrow);
    game.projectiles.push({ mesh: arrow, velocity: dir.clone().multiplyScalar(55), damage: enemy.damage, lifetime: 3.5, fromEnemy: true, type: 'arrow' });
  }, []);

  const shootRock = useCallback((enemy: Enemy) => {
    const game = gameRef.current;
    if (!game) return;
    const dir = new THREE.Vector3().subVectors(game.dragon.position, enemy.mesh.position).normalize();
    const rockGeo = new THREE.SphereGeometry(1, 8, 8);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.copy(enemy.mesh.position);
    rock.position.y += 5;
    const vel = dir.clone().multiplyScalar(40);
    vel.y += 18;
    game.scene.add(rock);
    game.projectiles.push({ mesh: rock, velocity: vel, damage: enemy.damage, lifetime: 5, fromEnemy: true, type: 'rock' });
  }, []);

  // ============================================================
  // CREATE DAMAGE NUMBER
  // ============================================================
  const createDamageNumber = useCallback((position: THREE.Vector3, damage: number, isHeal?: boolean) => {
    const game = gameRef.current;
    if (!game) return;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = isHeal ? '#44ff44' : '#ff4444';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    const text = `${Math.round(damage)}`;
    ctx.strokeText(text, 64, 48);
    ctx.fillText(text, 64, 48);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(position);
    sprite.position.y += 3;
    sprite.scale.set(3, 1.5, 1);
    game.scene.add(sprite);
    game.damageNumbers.push({ mesh: sprite, velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2), lifetime: 1.2, value: damage });
  }, []);

  // ============================================================
  // GAME LOOP
  // ============================================================
  const gameLoopRef = useRef<() => void>(() => {});

  const gameLoop = useCallback(() => {
    const game = gameRef.current;
    if (!game || !game.gameActive) return;

    const delta = Math.min(game.clock.getDelta(), 0.05);

    // ---- Day/Night cycle ----
    game.dayTime += delta * 0.015;
    const sunAngle = game.dayTime;
    const sunX = Math.cos(sunAngle) * 400;
    const sunY = Math.sin(sunAngle) * 300 + 50;
    const sunZ = 100;
    game.sunLight.position.set(sunX, sunY, sunZ);
    const sunIntensity = Math.max(0.15, Math.sin(sunAngle) * 0.5 + 0.5);
    game.sunLight.intensity = sunIntensity * 1.5;
    game.ambientLight.intensity = 0.15 + sunIntensity * 0.35;

    // Sun mesh position
    if (game.sunMesh) {
      game.sunMesh.position.set(sunX * 1.5, sunY * 1.5, sunZ * 1.5);
    }

    // Fog
    const fogDensity = 0.0012 + (1 - sunIntensity) * 0.002;
    game.scene.fog = new THREE.FogExp2(game.fogColor, fogDensity);

    // Sky color based on time
    const skyR = 0.15 + sunIntensity * 0.35;
    const skyG = 0.18 + sunIntensity * 0.37;
    const skyB = 0.25 + sunIntensity * 0.45;
    game.fogColor.setRGB(skyR, skyG, skyB);
    (game.scene.background as THREE.Color).copy(game.fogColor);

    // Bloom intensity based on sun
    if (game.bloomPass) {
      game.bloomPass.intensity = 0.8 + sunIntensity * 1.0;
    }

    // ---- Dragon Movement ----
    const dragon = game.dragon;
    const keys = game.keys;
    const moveSpeed = 22 * delta;
    const flySpeed = 35 * delta;
    const sprintSpeed = 1.8;
    const turnSpeed = 2.2 * delta;

    if (keys.has('a') || keys.has('arrowleft')) game.yaw += turnSpeed;
    if (keys.has('d') || keys.has('arrowright')) game.yaw -= turnSpeed;
    if (keys.has('w') || keys.has('arrowup')) game.pitch = Math.max(game.pitch - turnSpeed * 0.5, -1.2);
    if (keys.has('s') || keys.has('arrowdown')) game.pitch = Math.min(game.pitch + turnSpeed * 0.5, 1.0);

    dragon.rotation.set(0, 0, 0);
    dragon.rotateY(game.yaw);
    dragon.rotateX(game.pitch);

    // Bank on turn
    const targetBank = 0;
    if (keys.has('a') || keys.has('arrowleft')) dragon.rotateZ(0.15);
    if (keys.has('d') || keys.has('arrowright')) dragon.rotateZ(-0.15);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(dragon.quaternion);
    const isMovingForward = keys.has('w') || keys.has('arrowup');
    const isMovingBackward = keys.has('s') || keys.has('arrowdown');
    const isAscending = keys.has(' ');
    const isDescending = keys.has('shift');
    game.isSprinting = keys.has('e') && game.stats.stamina > 0;

    const speedMul = game.isSprinting ? sprintSpeed : 1;

    if (isMovingForward) {
      if (game.isFlying) {
        dragon.position.add(forward.clone().multiplyScalar(flySpeed * speedMul));
        game.stats.stamina -= delta * (game.isSprinting ? 8 : 3);
      } else {
        const flatFwd = new THREE.Vector3(forward.x, 0, forward.z).normalize();
        dragon.position.add(flatFwd.multiplyScalar(moveSpeed * speedMul));
        if (game.isSprinting) game.stats.stamina -= delta * 5;
      }
    }
    if (isMovingBackward) {
      if (game.isFlying) {
        dragon.position.add(forward.clone().multiplyScalar(-flySpeed * 0.4));
      } else {
        const flatFwd = new THREE.Vector3(forward.x, 0, forward.z).normalize();
        dragon.position.add(flatFwd.multiplyScalar(-moveSpeed * 0.5));
      }
    }

    if (isAscending && game.stats.stamina > 0) {
      game.isFlying = true;
      dragon.position.y += flySpeed * 1.8 * speedMul;
      game.stats.stamina -= delta * 6;
      game.isGrounded = false;
    }
    if (isDescending) {
      if (game.isFlying) {
        dragon.position.y -= flySpeed * 2.2;
      }
    }

    // Dive attack
    if (game.isDiving && game.isFlying) {
      game.diveVelocity.add(forward.clone().multiplyScalar(delta * 100));
      game.diveVelocity.y -= delta * 50;
      dragon.position.add(game.diveVelocity.clone().multiplyScalar(delta));
    }

    // Gravity
    const terrainHeight = getTerrainHeight(dragon.position.x, dragon.position.z, game.terrain);
    const groundLevel = Math.max(terrainHeight + 2, WATER_LEVEL + 2);

    if (!game.isFlying && !game.isDiving) {
      if (dragon.position.y > groundLevel + 0.5) {
        game.dragonVelocity.y -= 25 * delta;
        dragon.position.add(game.dragonVelocity.clone().multiplyScalar(delta));
      }
      if (dragon.position.y <= groundLevel) {
        dragon.position.y = groundLevel;
        game.dragonVelocity.set(0, 0, 0);
        game.isGrounded = true;
        game.isFlying = false;
      }
    }

    if (game.isFlying && dragon.position.y <= groundLevel) {
      dragon.position.y = groundLevel;
      game.isFlying = false;
      game.isGrounded = true;
      game.isDiving = false;
      game.diveVelocity.set(0, 0, 0);
      game.dragonVelocity.set(0, 0, 0);
      // Landing camera shake
      game.cameraShake = 0.5;
    }

    // Wing animation
    if (game.isFlying || isAscending) {
      game.wingAngle += game.wingDir * delta * 10;
      if (game.wingAngle > 0.9 || game.wingAngle < -0.2) game.wingDir *= -1;
    } else {
      game.wingAngle = 0.3;
    }

    dragon.traverse(child => {
      if (child.name === 'leftWing') child.rotation.z = game.wingAngle;
      if (child.name === 'rightWing') child.rotation.z = -game.wingAngle;
    });

    // Tail wag animation
    if (game.dragonModel) {
      game.mixer?.update(delta);
    }

    // Survival regen
    game.staminaRegenTimer += delta;
    if (game.staminaRegenTimer > 0.4) {
      game.staminaRegenTimer = 0;
      if (game.isGrounded) {
        game.stats.stamina = Math.min(game.stats.maxStamina, game.stats.stamina + 4);
        game.stats.breathFuel = Math.min(game.stats.maxBreathFuel, game.stats.breathFuel + 2);
      } else {
        game.stats.stamina = Math.min(game.stats.maxStamina, game.stats.stamina + 1);
        game.stats.breathFuel = Math.min(game.stats.maxBreathFuel, game.stats.breathFuel + 0.5);
      }
    }

    game.hungerTimer += delta;
    if (game.hungerTimer > 4) {
      game.hungerTimer = 0;
      game.stats.hunger = Math.max(0, game.stats.hunger - 2);
      if (game.stats.hunger <= 0) {
        game.stats.health -= 4;
      }
    }

    // Fire breath
    if (game.isBreathingFire) {
      game.fireBreathTimer += delta;
      if (game.fireBreathTimer > 0.08) {
        game.fireBreathTimer = 0;
        breatheFire();
      }
    }
    if (!game.mouse.down) {
      game.isBreathingFire = false;
      game.fireLight.intensity *= 0.85;
    }

    // Dive attack
    if (game.mouse.rightDown && game.isFlying && !game.isDiving) {
      game.isDiving = true;
      game.diveVelocity = forward.clone().multiplyScalar(40);
      game.diveVelocity.y = -20;
    }

    // Roar (R key) - stun nearby enemies
    if (keys.has('r') && game.stats.stamina > 20) {
      game.stats.stamina -= 20;
      game.cameraShake = 0.8;
      game.enemies.forEach(enemy => {
        if (!enemy.alive) return;
        const dist = enemy.mesh.position.distanceTo(dragon.position);
        if (dist < 30) {
          enemy.stunned = 3;
          createDamageNumber(enemy.mesh.position.clone(), 0, true);
        }
      });
      keys.delete('r');
    }

    // ---- Camera with shake ----
    const camDist = 20;
    const camH = 10;
    const idealOffset = new THREE.Vector3(0, camH, camDist).applyQuaternion(dragon.quaternion).add(dragon.position);
    const idealLookAt = new THREE.Vector3(0, 3, -12).applyQuaternion(dragon.quaternion).add(dragon.position);

    game.camera.position.lerp(idealOffset, 6 * delta);
    game.camera.lookAt(idealLookAt);

    if (game.cameraShake > 0) {
      game.camera.position.x += (Math.random() - 0.5) * game.cameraShake;
      game.camera.position.y += (Math.random() - 0.5) * game.cameraShake;
      game.cameraShake *= 0.9;
      if (game.cameraShake < 0.01) game.cameraShake = 0;
    }

    // ---- Combo system ----
    game.comboTimer -= delta;
    if (game.comboTimer <= 0) {
      game.comboCount = 0;
      game.killStreak = 0;
    }

    // ---- Enemies AI ----
    game.enemies.forEach(enemy => {
      if (!enemy.alive) return;

      enemy.fireTimer += delta;
      if (enemy.stunned > 0) { enemy.stunned -= delta; return; }
      if (enemy.hitFlash > 0) {
        enemy.hitFlash -= delta;
        if (enemy.mesh.children[0]) {
          (enemy.mesh.children[0].material as THREE.MeshStandardMaterial).emissiveIntensity =
            enemy.hitFlash > 0 ? 2 : 0;
        }
      }

      const distToPlayer = enemy.mesh.position.distanceTo(dragon.position);

      if (enemy.type === 'dragon' || enemy.type === 'boss') {
        enemy.patrolAngle += delta * 0.4;

        if (distToPlayer < enemy.aggroRange) {
          const toPlayer = new THREE.Vector3().subVectors(dragon.position, enemy.mesh.position).normalize();
          enemy.mesh.position.add(toPlayer.multiplyScalar(enemy.speed * delta));
          enemy.mesh.lookAt(dragon.position);

          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
            enemy.fireTimer = 0;
            enemyBreatheFire(enemy);
          }
        } else {
          const pR = 50;
          const cx = enemy.type === 'boss' ? 0 : 250;
          const cz = enemy.type === 'boss' ? 0 : -200;
          enemy.mesh.position.x = cx + Math.cos(enemy.patrolAngle) * pR;
          enemy.mesh.position.z = cz + Math.sin(enemy.patrolAngle) * pR;
          enemy.mesh.position.y = 40 + Math.sin(enemy.patrolAngle * 2) * 12;
          enemy.mesh.rotation.y = enemy.patrolAngle + Math.PI / 2;
        }

        const ew = Math.sin(enemy.patrolAngle * 5) * 0.6;
        enemy.mesh.traverse(c => {
          if (c.name === 'leftWing') c.rotation.z = ew;
          if (c.name === 'rightWing') c.rotation.z = -ew;
        });
      } else if (enemy.type === 'knight') {
        if (distToPlayer < enemy.aggroRange) {
          const toPlayer = new THREE.Vector3().subVectors(dragon.position, enemy.mesh.position).normalize();
          if (distToPlayer > 5) {
            enemy.mesh.position.add(toPlayer.multiplyScalar(enemy.speed * delta));
          }
          enemy.mesh.lookAt(dragon.position);

          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
            enemy.fireTimer = 0;
            // Melee hit
            if (distToPlayer < 8) {
              game.stats.health -= enemy.damage;
              game.cameraShake = 0.3;
              createDamageNumber(dragon.position.clone(), enemy.damage);
            }
          }
        }
      } else if (enemy.type === 'archer') {
        if (distToPlayer < enemy.aggroRange) {
          enemy.mesh.lookAt(dragon.position);
          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
            enemy.fireTimer = 0;
            shootArrow(enemy);
          }
        }
      } else if (enemy.type === 'catapult') {
        if (distToPlayer < enemy.aggroRange) {
          enemy.mesh.lookAt(dragon.position);
          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
            enemy.fireTimer = 0;
            shootRock(enemy);
          }
        }
      }
    });

    // ---- Projectiles ----
    game.projectiles = game.projectiles.filter(proj => {
      proj.lifetime -= delta;
      if (proj.lifetime <= 0) { game.scene.remove(proj.mesh); proj.mesh.geometry.dispose(); return false; }

      proj.mesh.position.add(proj.velocity.clone().multiplyScalar(delta));
      if (proj.type === 'rock') proj.velocity.y -= 15 * delta;

      if (proj.fromEnemy) {
        const dist = proj.mesh.position.distanceTo(dragon.position);
        if (dist < 3.5 * game.dragonScale) {
          game.stats.health -= proj.damage;
          game.cameraShake = proj.type === 'rock' ? 0.6 : 0.2;
          createDamageNumber(dragon.position.clone(), proj.damage);
          game.scene.remove(proj.mesh);
          proj.mesh.geometry.dispose();
          return false;
        }
      }
      return true;
    });

    // ---- Fire Particles ----
    game.fireParticles = game.fireParticles.filter(particle => {
      particle.lifetime -= delta;
      if (particle.lifetime <= 0) { game.scene.remove(particle.mesh); particle.mesh.geometry.dispose(); return false; }

      particle.mesh.position.add(particle.velocity.clone().multiplyScalar(delta));
      particle.velocity.y += 6 * delta;
      const lifeRatio = particle.lifetime / particle.maxLifetime;
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = lifeRatio;
      particle.mesh.scale.setScalar(lifeRatio * 1.5);

      for (const enemy of game.enemies) {
        if (!enemy.alive) continue;
        const dist = particle.mesh.position.distanceTo(enemy.mesh.position);
        const hitRadius = enemy.type === 'boss' ? 6 : 3.5;
        if (dist < hitRadius) {
          const dmg = 18 + game.stats.level * 2;
          enemy.health -= dmg;
          enemy.hitFlash = 0.15;
          if (enemy.mesh.children[0]) {
            (enemy.mesh.children[0].material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xff4400);
            (enemy.mesh.children[0].material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
          }
          createDamageNumber(enemy.mesh.position.clone(), dmg);

          game.comboCount++;
          game.comboTimer = 3;
          game.killStreak++;

          if (enemy.health <= 0) {
            enemy.alive = false;
            game.scene.remove(enemy.mesh);
            const xpGain = enemy.type === 'boss' ? 300 : enemy.type === 'dragon' ? 80 : enemy.type === 'catapult' ? 40 : enemy.type === 'knight' ? 35 : 20;
            const goldGain = enemy.type === 'boss' ? 500 : enemy.type === 'dragon' ? 120 : enemy.type === 'knight' ? 30 : 15;
            game.stats.xp += xpGain;
            game.stats.gold += goldGain;
            game.stats.hunger = Math.min(game.stats.maxHunger, game.stats.hunger + 8);

            if (game.killStreak > 1) {
              showNotification(`${game.killStreak}x Kill Streak! +${goldGain} Gold`);
            }

            // Level up
            if (game.stats.xp >= game.stats.xpToNext) {
              game.stats.level++;
              game.stats.xp -= game.stats.xpToNext;
              game.stats.xpToNext = Math.floor(game.stats.xpToNext * 1.6);
              game.stats.maxHealth += 15;
              game.stats.health = game.stats.maxHealth;
              game.stats.maxStamina += 12;
              game.stats.stamina = game.stats.maxStamina;
              game.stats.maxBreathFuel += 10;
              game.stats.breathFuel = game.stats.maxBreathFuel;
              game.dragonScale = 1 + game.stats.level * 0.08;
              dragon.scale.setScalar(game.dragonScale);
              game.cameraShake = 0.5;
              showNotification(`LEVEL UP! Now Level ${game.stats.level}! Dragon grows stronger!`);
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
                  m.completed = true;
                  showNotification(`Mission Complete: ${m.title}!`);
                  if (mi < game.missions.length - 1) game.missionIndex = mi + 1;
                }
              }
            }
          }
          game.scene.remove(particle.mesh);
          particle.mesh.geometry.dispose();
          return false;
        }
      }
      return true;
    });

    // ---- Damage numbers ----
    game.damageNumbers = game.damageNumbers.filter(dn => {
      dn.lifetime -= delta;
      if (dn.lifetime <= 0) { game.scene.remove(dn.mesh); return false; }
      dn.mesh.position.add(dn.velocity.clone().multiplyScalar(delta));
      dn.velocity.y -= 3 * delta;
      (dn.mesh.material as THREE.SpriteMaterial).opacity = dn.lifetime / 1.2;
      return true;
    });

    // Dive attack landing
    if (game.isDiving && game.isGrounded) {
      game.isDiving = false;
      game.diveVelocity.set(0, 0, 0);
      game.cameraShake = 1.0;
      game.enemies.forEach(enemy => {
        if (!enemy.alive) return;
        const dist = enemy.mesh.position.distanceTo(dragon.position);
        if (dist < 20) {
          const dmg = 60 + game.stats.level * 5;
          enemy.health -= dmg;
          createDamageNumber(enemy.mesh.position.clone(), dmg);
          if (enemy.health <= 0) {
            enemy.alive = false;
            game.scene.remove(enemy.mesh);
            game.stats.xp += 30;
            game.stats.gold += 20;
          }
        }
      });
    }

    // Territory
    game.territories.forEach(terr => {
      if (terr.controlled) return;
      const dist = dragon.position.distanceTo(terr.center);
      if (dist < terr.radius) {
        const enemiesInArea = game.enemies.filter(e => e.alive && e.mesh.position.distanceTo(terr.center) < terr.radius);
        if (enemiesInArea.length === 0) {
          terr.controlled = true;
          game.stats.territory++;
          showNotification(`Territory Claimed: ${terr.name}!`);
        }
      }
    });

    // Clamp position
    const boundary = TERRAIN_SIZE / 2 - 30;
    dragon.position.x = Math.max(-boundary, Math.min(boundary, dragon.position.x));
    dragon.position.z = Math.max(-boundary, Math.min(boundary, dragon.position.z));
    if (dragon.position.y > 200) dragon.position.y = 200;

    // Update React state
    setStats({ ...game.stats });
    if (game.missionIndex < game.missions.length) {
      const m = game.missions[game.missionIndex];
      if (!m.completed) {
        setCurrentMission({ ...m });
      } else if (game.missionIndex === game.missions.length - 1) {
        setGameState('victory');
        game.gameActive = false;
      }
    }

    if (game.notificationTimer > 0) {
      game.notificationTimer -= delta;
      if (game.notificationTimer <= 0) setNotification('');
    }

    if (game.stats.health <= 0) {
      game.stats.health = 0;
      setGameState('gameover');
      game.gameActive = false;
    }

    // Render with post-processing
    game.composer.render(delta);
    game.animationId = requestAnimationFrame(() => gameLoopRef.current());
  }, [breatheFire, createDamageNumber, enemyBreatheFire, getTerrainHeight, shootArrow, shootRock, showNotification]);

  useEffect(() => { gameLoopRef.current = gameLoop; }, [gameLoop]);

  // ============================================================
  // INITIALIZE GAME
  // ============================================================
  const initGame = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Scene
    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x4a5568);
    scene.fog = new THREE.FogExp2(fogColor, 0.002);
    scene.background = fogColor;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(0, 25, 30);

    // Renderer - AAA quality
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Post-processing
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomEffect = new BloomEffect({
      luminanceThreshold: 0.6,
      luminanceSmoothing: 0.3,
      intensity: 1.5,
    });
    const bloomPass = new EffectPass(camera, bloomEffect);
    composer.addPass(bloomPass);

    const smaaEffect = new SMAAEffect({ preset: SMAAPreset.HIGH });
    const smaaPass = new EffectPass(camera, smaaEffect);
    composer.addPass(smaaPass);

    const vignetteEffect = new VignetteEffect({ offset: 0.3, darkness: 0.5 });
    const vignettePass = new EffectPass(camera, vignetteEffect);
    composer.addPass(vignettePass);

    // Lighting - AAA
    const ambientLight = new THREE.AmbientLight(0x404060, 0.4);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
    sunLight.position.set(150, 200, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 800;
    sunLight.shadow.camera.left = -300;
    sunLight.shadow.camera.right = 300;
    sunLight.shadow.camera.top = 300;
    sunLight.shadow.camera.bottom = -300;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x88aacc, 0x443322, 0.5);
    scene.add(hemiLight);

    // Sun visual
    const sunGeo = new THREE.SphereGeometry(15, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(400, 300, 100);
    scene.add(sunMesh);

    // Terrain
    const { terrain, water } = generateTerrain(scene);

    // Structures
    const structures = createStructures(scene);

    // Dragon - try to load GLB, fallback to procedural
    let dragonObj: THREE.Group;
    let mixer: THREE.AnimationMixer | null = null;
    let dragonModel: THREE.Group | null = null;
    let fireLight: THREE.PointLight;

    // Load GLB model
    const loader = new GLTFLoader();
    const proceduralDragon = createProceduralDragon(scene);
    dragonObj = proceduralDragon;
    fireLight = dragonObj.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight;

    // Try loading GLB
    loader.load(
      '/models/demon_dragon.glb',
      (gltf) => {
        const model = gltf.scene;
        model.scale.set(0.8, 0.8, 0.8);
        model.position.copy(dragonObj.position);
        model.rotation.copy(dragonObj.rotation);

        // Enable shadows on all meshes
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Add fire light to model
        const fLight = new THREE.PointLight(0xff4400, 0, 25);
        fLight.position.set(0, 1.0, -4.5);
        model.add(fLight);

        // Replace procedural dragon with GLB model
        scene.remove(dragonObj);
        scene.add(model);

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          const idle = gltf.animations[0];
          const action = mixer.clipAction(idle);
          action.play();

          // Try to play flying animation if available
          for (const anim of gltf.animations) {
            if (anim.name.toLowerCase().includes('fly') || anim.name.toLowerCase().includes('walk')) {
              const flyAction = mixer.clipAction(anim);
              flyAction.play();
            }
          }
        }

        // Update ref
        if (gameRef.current) {
          gameRef.current.dragon = model;
          gameRef.current.fireLight = fLight;
          gameRef.current.dragonModel = model;
          gameRef.current.mixer = mixer;
        }
        dragonModel = model;
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          setLoadingProgress(pct);
        }
      },
      (error) => {
        console.warn('GLB load failed, using procedural dragon:', error);
      }
    );

    // Enemies
    const enemies = spawnEnemies(scene);

    // Atmospheric particles
    const pCount = 1000;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i += 3) {
      pPos[i] = (Math.random() - 0.5) * 800;
      pPos[i + 1] = Math.random() * 80 + 5;
      pPos[i + 2] = (Math.random() - 0.5) * 800;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.6, transparent: true, opacity: 0.25 });
    scene.add(new THREE.Points(pGeo, pMat));

    // Ember particles near volcano
    const emberCount = 200;
    const emberGeo = new THREE.BufferGeometry();
    const emberPos = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount * 3; i += 3) {
      emberPos[i] = -350 + (Math.random() - 0.5) * 60;
      emberPos[i + 1] = Math.random() * 40 + 40;
      emberPos[i + 2] = -300 + (Math.random() - 0.5) * 60;
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    const emberMat = new THREE.PointsMaterial({ color: 0xff4400, size: 0.8, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Points(emberGeo, emberMat));

    // Territories
    const territories: Territory[] = [
      { name: 'Eastern Hills', center: new THREE.Vector3(260, 0, -40), radius: 70, controlled: false },
      { name: 'Village Outskirts', center: new THREE.Vector3(50, 0, -65), radius: 60, controlled: false },
      { name: 'Northern Mountains', center: new THREE.Vector3(250, 0, -200), radius: 80, controlled: false },
      { name: 'Castle Gate', center: new THREE.Vector3(150, 0, 80), radius: 70, controlled: false },
      { name: 'Castle Interior', center: new THREE.Vector3(150, 0, 100), radius: 50, controlled: false },
      { name: 'Central Plains', center: new THREE.Vector3(0, 0, 0), radius: 50, controlled: false },
      { name: 'Ancient Ruins', center: new THREE.Vector3(-150, 0, -350), radius: 60, controlled: false },
      { name: 'Volcanic Wastes', center: new THREE.Vector3(-350, 0, -300), radius: 70, controlled: false },
    ];

    const missions = createMissions();

    const game = {
      scene, camera, renderer, composer,
      dragon: dragonObj,
      clock: new THREE.Clock(),
      keys: new Set<string>(),
      mouse: { x: 0, y: 0, down: false, rightDown: false },
      stats: {
        health: 150, maxHealth: 150,
        stamina: 120, maxStamina: 120,
        hunger: 100, maxHunger: 100,
        xp: 0, level: 1, xpToNext: 100,
        territory: 0, gold: 0,
        breathFuel: 100, maxBreathFuel: 100,
      },
      enemies, projectiles: [], fireParticles: [], damageNumbers: [],
      missions, missionIndex: 0, territories,
      isGrounded: true, isFlying: false, isBreathingFire: false,
      isDiving: false, isSprinting: false,
      diveVelocity: new THREE.Vector3(),
      dragonVelocity: new THREE.Vector3(),
      animationId: 0, terrain, water,
      yaw: 0, pitch: 0,
      wingAngle: 0.3, wingDir: 1,
      hungerTimer: 0, staminaRegenTimer: 0, fireBreathTimer: 0,
      notificationTimer: 0, dragonScale: 1,
      gameActive: true, dayTime: Math.PI / 3,
      sunLight, sunMesh, ambientLight, fogColor, structures,
      fireLight, dragonModel, mixer,
      cameraShake: 0, comboCount: 0, comboTimer: 0,
      killStreak: 0, lastHitTime: 0,
      bloomPass: bloomEffect,
    };

    gameRef.current = game;

    setTimeout(() => {
      setMissionIndex(0);
      setCurrentMission(missions[0]);
    }, 0);

    // Input
    const onKeyDown = (e: KeyboardEvent) => {
      game.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') setGameState(prev => prev === 'playing' ? 'paused' : 'playing');
      if (e.key === 'Tab') { e.preventDefault(); setShowControls(prev => !prev); }
    };
    const onKeyUp = (e: KeyboardEvent) => game.keys.delete(e.key.toLowerCase());
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) game.mouse.down = true;
      if (e.button === 2) game.mouse.rightDown = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) game.mouse.down = false;
      if (e.button === 2) game.mouse.rightDown = false;
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onMouseMove = (e: MouseEvent) => {
      game.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      game.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      game.camera.aspect = w / h;
      game.camera.updateProjectionMatrix();
      game.renderer.setSize(w, h);
      game.composer.setSize(w, h);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);

    game.animationId = requestAnimationFrame(() => gameLoopRef.current());

    return () => {
      game.gameActive = false;
      cancelAnimationFrame(game.animationId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [createMissions, createProceduralDragon, createStructures, generateTerrain, gameLoop, spawnEnemies]);

  // ============================================================
  // START GAME
  // ============================================================
  useEffect(() => {
    if (gameState !== 'playing') return;
    const cleanup = initGame();
    return cleanup;
  }, [gameState, initGame]);

  // ============================================================
  // RENDER UI
  // ============================================================
  if (!mounted) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-amber-500 mb-4">DRAGON&apos;S REIGN</h1>
          <p className="text-amber-200/60 animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen relative overflow-hidden bg-black" ref={containerRef}>
      {/* ---- MENU ---- */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-gray-950 via-gray-900 to-red-950">
          <div className="text-center">
            <div className="text-8xl mb-4">🐉</div>
            <h1 className="text-7xl font-black text-amber-400 mb-2 tracking-widest"
              style={{ textShadow: '0 0 60px rgba(217,119,6,0.6), 0 0 120px rgba(217,119,6,0.3)' }}>
              DRAGON&apos;S REIGN
            </h1>
            <p className="text-xl text-amber-200/60 mb-1 tracking-wider">MEDIEVAL SURVIVAL</p>
            <p className="text-sm text-gray-500 mb-10">Open World • Deep Survival • Story Campaign</p>

            <button onClick={() => setGameState('playing')}
              className="px-14 py-5 bg-gradient-to-r from-red-900 to-red-700 hover:from-red-800 hover:to-red-600 text-amber-100 text-2xl font-black rounded-xl border-2 border-amber-500/40 shadow-2xl shadow-red-900/60 transition-all hover:scale-110 hover:shadow-red-600/50 mb-8">
              BEGIN CONQUEST
            </button>

            <div className="mt-6 text-gray-500 text-xs space-y-1 max-w-lg mx-auto">
              <p>WASD — Move | Space — Fly Up | Shift — Fly Down | E — Sprint</p>
              <p>Left Click — Fire Breath | Right Click — Dive Attack | R — Roar Stun</p>
              <p>Tab — Controls | Esc — Pause</p>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-red-950/50 to-transparent" />
        </div>
      )}

      {/* ---- HUD ---- */}
      {gameState === 'playing' && (
        <>
          {/* Stats */}
          <div className="absolute top-4 left-4 z-30 space-y-1.5 min-w-[240px]">
            {[
              { label: 'HEALTH', val: stats.health, max: stats.maxHealth, colors: 'from-red-800 to-red-500', border: 'border-red-900/30', text: 'text-red-400' },
              { label: 'STAMINA', val: stats.stamina, max: stats.maxStamina, colors: 'from-yellow-800 to-yellow-400', border: 'border-yellow-900/30', text: 'text-yellow-400' },
              { label: 'HUNGER', val: stats.hunger, max: stats.maxHunger, colors: 'from-green-800 to-green-400', border: 'border-green-900/30', text: 'text-green-400' },
              { label: 'BREATH FUEL', val: stats.breathFuel, max: stats.maxBreathFuel, colors: 'from-orange-800 to-orange-400', border: 'border-orange-900/30', text: 'text-orange-400' },
            ].map(s => (
              <div key={s.label} className={`bg-black/70 rounded-lg p-2 backdrop-blur-sm ${s.border} border`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`${s.text} text-[10px] font-bold`}>{s.label}</span>
                  <span className={`${s.text} text-[10px] opacity-70`}>{Math.round(s.val)}/{s.max}</span>
                </div>
                <div className="w-full h-2.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full bg-gradient-to-r ${s.colors} rounded-full transition-all`}
                    style={{ width: `${(s.val / s.max) * 100}%` }} />
                </div>
              </div>
            ))}

            <div className="bg-black/70 rounded-lg p-2 backdrop-blur-sm border border-amber-900/30">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-amber-400 text-[10px] font-bold">LEVEL {stats.level}</span>
                <span className="text-amber-300 text-[10px] opacity-70">{stats.xp}/{stats.xpToNext} XP</span>
              </div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-all"
                  style={{ width: `${(stats.xp / stats.xpToNext) * 100}%` }} />
              </div>
            </div>

            <div className="flex gap-2">
              <div className="bg-black/70 rounded-lg px-3 py-1.5 backdrop-blur-sm border border-purple-900/30 flex-1">
                <span className="text-purple-400 text-[10px] font-bold">TERRITORY </span>
                <span className="text-purple-300 text-[10px]">{stats.territory}/8</span>
              </div>
              <div className="bg-black/70 rounded-lg px-3 py-1.5 backdrop-blur-sm border border-amber-900/30 flex-1">
                <span className="text-amber-400 text-[10px] font-bold">GOLD </span>
                <span className="text-amber-300 text-[10px]">{stats.gold}</span>
              </div>
            </div>
          </div>

          {/* Mission */}
          {currentMission && (
            <div className="absolute top-4 right-4 z-30 max-w-xs">
              <div className="bg-black/70 rounded-lg p-3 backdrop-blur-sm border border-amber-900/30">
                <h3 className="text-amber-400 text-xs font-bold mb-1">MISSION {currentMission.id}: {currentMission.title}</h3>
                <p className="text-gray-300 text-[10px] mb-2 leading-relaxed">{currentMission.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-[10px]">{currentMission.objective}</span>
                  <span className="text-amber-300 text-xs font-bold">{currentMission.currentCount}/{currentMission.targetCount}</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-all"
                    style={{ width: `${(currentMission.currentCount / currentMission.targetCount) * 100}%` }} />
                </div>
                <p className="text-green-400/80 text-[10px] mt-1">{currentMission.reward}</p>
              </div>
            </div>
          )}

          {/* Crosshair */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="w-8 h-8 border-2 border-amber-400/40 rounded-full" />
            <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-amber-400 rounded-full -translate-x-1/2 -translate-y-1/2" />
          </div>

          {/* Notification */}
          {notification && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
              <div className="bg-amber-900/80 text-amber-200 px-8 py-4 rounded-xl text-lg font-black border border-amber-500/50 backdrop-blur-md"
                style={{ textShadow: '0 0 10px rgba(217,119,6,0.5)' }}>
                {notification}
              </div>
            </div>
          )}

          {/* Controls */}
          {showControls && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
              <div className="bg-black/90 rounded-xl p-6 backdrop-blur-md border border-amber-800/40 min-w-[360px]">
                <h3 className="text-amber-400 text-xl font-black mb-4 text-center">CONTROLS</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['W / Up', 'Move Forward'], ['S / Down', 'Move Backward'],
                    ['A / Left', 'Turn Left'], ['D / Right', 'Turn Right'],
                    ['Space', 'Fly Up'], ['Shift', 'Fly Down'],
                    ['E', 'Sprint (uses Stamina)'],
                    ['Left Click', 'Fire Breath'], ['Right Click', 'Dive Attack'],
                    ['R', 'Roar Stun (AoE)'], ['Tab', 'Toggle Controls'], ['Esc', 'Pause'],
                  ].map(([key, desc]) => (
                    <React.Fragment key={key}>
                      <div className="text-gray-400">{key}</div>
                      <div className="text-gray-200">{desc}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bottom bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex gap-3">
            <div className="bg-black/60 rounded-full px-4 py-1 backdrop-blur-sm border border-gray-700/30">
              <span className="text-xs text-gray-300">{stats.stamina < 10 ? '⚠ EXHAUSTED' : stats.breathFuel < 10 ? '⚠ LOW BREATH' : '⚔ Ready'}</span>
            </div>
          </div>
        </>
      )}

      {/* ---- PAUSE ---- */}
      {gameState === 'paused' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md">
          <h2 className="text-5xl font-black text-amber-400 mb-8" style={{ textShadow: '0 0 30px rgba(217,119,6,0.4)' }}>PAUSED</h2>
          <button onClick={() => setGameState('playing')}
            className="px-10 py-4 bg-red-800 hover:bg-red-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-600/40 transition-all hover:scale-105 mb-4">
            RESUME
          </button>
          <button onClick={() => setGameState('menu')}
            className="px-10 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-lg rounded-xl border border-gray-600/40 transition-all hover:scale-105">
            MAIN MENU
          </button>
        </div>
      )}

      {/* ---- GAME OVER ---- */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-black via-red-950/80 to-black">
          <div className="text-7xl mb-4">💀</div>
          <h2 className="text-6xl font-black text-red-500 mb-4" style={{ textShadow: '0 0 40px rgba(220,38,38,0.5)' }}>FALLEN</h2>
          <p className="text-gray-400 text-lg mb-2">Your reign has ended.</p>
          <p className="text-amber-400 mb-8">Level {stats.level} | Territory: {stats.territory}/8 | Gold: {stats.gold}</p>
          <button onClick={() => setGameState('menu')}
            className="px-10 py-4 bg-red-800 hover:bg-red-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-600/40 transition-all hover:scale-105">
            TRY AGAIN
          </button>
        </div>
      )}

      {/* ---- VICTORY ---- */}
      {gameState === 'victory' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-amber-950 via-gray-900 to-amber-950">
          <div className="text-7xl mb-4">👑</div>
          <h2 className="text-6xl font-black text-amber-400 mb-4" style={{ textShadow: '0 0 50px rgba(217,119,6,0.6)' }}>
            KINGDOM CONQUERED
          </h2>
          <p className="text-amber-200/80 text-lg mb-2">The Dragon King has fallen. You rule the skies.</p>
          <p className="text-amber-400 mb-8">Level {stats.level} | Territory: {stats.territory}/8 | Gold: {stats.gold}</p>
          <button onClick={() => setGameState('menu')}
            className="px-10 py-4 bg-amber-800 hover:bg-amber-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-500/40 transition-all hover:scale-105">
            PLAY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}
