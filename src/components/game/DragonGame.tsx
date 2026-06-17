'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

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
  type: 'archer' | 'catapult' | 'dragon';
  health: number;
  maxHealth: number;
  speed: number;
  attackCooldown: number;
  attackRange: number;
  damage: number;
  alive: boolean;
  position: THREE.Vector3;
  targetPosition?: THREE.Vector3;
  patrolAngle: number;
  fireTimer: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  lifetime: number;
  fromEnemy: boolean;
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
  enemyCount: number;
  enemiesDefeated: number;
}

const TERRAIN_SIZE = 800;
const TERRAIN_SEGMENTS = 128;
const WATER_LEVEL = 2;

// ============================================================
// DRAGON GAME COMPONENT
// ============================================================

export default function DragonGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ensure client-only rendering to prevent hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Use flushSync alternative: defer to next tick
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'paused' | 'gameover' | 'victory'>('menu');
  const [stats, setStats] = useState<SurvivalStats>({
    health: 100, maxHealth: 100,
    stamina: 100, maxStamina: 100,
    hunger: 100, maxHunger: 100,
    xp: 0, level: 1, xpToNext: 100,
    territory: 0,
  });
  const [currentMission, setCurrentMission] = useState<Mission | null>(null);
  const [missionIndex, setMissionIndex] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [notification, setNotification] = useState<string>('');

  // Refs for game objects that need to persist across renders
  const gameRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    dragon: THREE.Group;
    dragonMixer: THREE.AnimationMixer | null;
    clock: THREE.Clock;
    keys: Set<string>;
    mouse: { x: number; y: number; down: boolean; rightDown: boolean };
    stats: SurvivalStats;
    enemies: Enemy[];
    projectiles: Projectile[];
    fireParticles: FireParticle[];
    missions: Mission[];
    missionIndex: number;
    territories: Territory[];
    isGrounded: boolean;
    isFlying: boolean;
    isBreathingFire: boolean;
    isDiving: boolean;
    diveVelocity: THREE.Vector3;
    dragonVelocity: THREE.Vector3;
    cameraOffset: THREE.Vector3;
    cameraLookOffset: THREE.Vector3;
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
    ambientLight: THREE.AmbientLight;
    fogColor: THREE.Color;
    structures: THREE.Group[];
    arrowCooldown: number;
    minimapCanvas: HTMLCanvasElement | null;
    fireLight: THREE.PointLight;
  } | null>(null);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    if (gameRef.current) gameRef.current.notificationTimer = 3;
  }, []);

  // ============================================================
  // MISSIONS DATA
  // ============================================================
  const createMissions = useCallback((): Mission[] => [
    {
      id: 1, title: 'The Awakening',
      description: 'You have awakened in a hostile kingdom. The archer garrison on the eastern hills has been attacking your kind for centuries.',
      objective: 'Destroy the archer garrison', targetCount: 5, currentCount: 0, completed: false,
      reward: '+50 XP, Fire Breath Upgrade',
    },
    {
      id: 2, title: 'Rival Skies',
      description: 'A rival dragon has claimed the northern mountains as its territory. Defeat it to expand your domain.',
      objective: 'Defeat the rival dragon', targetCount: 1, currentCount: 0, completed: false,
      reward: '+100 XP, Territory Expanded',
    },
    {
      id: 3, title: 'Siege Breaker',
      description: 'The kingdom has deployed catapults along the castle walls. Destroy them before they bring you down.',
      objective: 'Destroy the catapult defenses', targetCount: 3, currentCount: 0, completed: false,
      reward: '+75 XP, Stamina Boost',
    },
    {
      id: 4, title: 'Conquer the Castle',
      description: 'The castle stands as the heart of the kingdom. Claim it by defeating all defenders within its walls.',
      objective: 'Clear the castle defenders', targetCount: 8, currentCount: 0, completed: false,
      reward: '+150 XP, Castle Territory Claimed',
    },
    {
      id: 5, title: 'The Dragon King',
      description: 'The ancient Dragon King, corrupted by dark magic, threatens all life. Defeat it to become the true ruler of the skies.',
      objective: 'Defeat the Dragon King', targetCount: 1, currentCount: 0, completed: false,
      reward: 'Victory - Kingdom Conquered',
    },
  ], []);

  // ============================================================
  // TERRAIN GENERATION
  // ============================================================
  const generateTerrain = useCallback((scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array as Float32Array;
    const colors = new Float32Array(vertices.length);

    // Define biome centers
    const lakeCenter = new THREE.Vector2(-120, -80);
    const castleHill = new THREE.Vector2(80, 60);
    const forestCenter = new THREE.Vector2(-60, 100);
    const mountainCenter = new THREE.Vector2(100, -100);
    const villageCenter = new THREE.Vector2(20, -40);

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const z = vertices[i + 2];

      // Distance to biome centers
      const dLake = Math.sqrt((x - lakeCenter.x) ** 2 + (z - lakeCenter.y) ** 2);
      const dCastle = Math.sqrt((x - castleHill.x) ** 2 + (z - castleHill.y) ** 2);
      const dForest = Math.sqrt((x - forestCenter.x) ** 2 + (z - forestCenter.y) ** 2);
      const dMountain = Math.sqrt((x - mountainCenter.x) ** 2 + (z - mountainCenter.y) ** 2);
      const dVillage = Math.sqrt((x - villageCenter.x) ** 2 + (z - villageCenter.y) ** 2);

      let y = 0;

      // Base terrain noise using sin waves
      y += Math.sin(x * 0.01) * 5;
      y += Math.cos(z * 0.015) * 4;
      y += Math.sin(x * 0.03 + z * 0.02) * 3;
      y += Math.cos(x * 0.005) * Math.sin(z * 0.005) * 10;

      // Lake depression
      if (dLake < 80) {
        const factor = 1 - dLake / 80;
        y -= factor * 25;
      }

      // Castle hill
      if (dCastle < 60) {
        const factor = 1 - dCastle / 60;
        y += factor * 30;
      }

      // Mountains
      if (dMountain < 120) {
        const factor = 1 - dMountain / 120;
        y += factor * factor * 60;
      }

      // Forest gentle hills
      if (dForest < 90) {
        const factor = 1 - dForest / 90;
        y += factor * 8;
      }

      // Village flat area
      if (dVillage < 50) {
        const factor = 1 - dVillage / 50;
        y = y * (1 - factor * 0.7);
      }

      vertices[i + 1] = y;

      // Color based on biome
      let r = 0.25, g = 0.45, b = 0.15; // Default grass

      if (dLake < 85) {
        // Lake shore to water transition
        const t = Math.max(0, 1 - dLake / 85);
        if (y < WATER_LEVEL + 2) {
          r = 0.1; g = 0.25; b = 0.4; // Deep water
        } else {
          r = 0.6; g = 0.55; b = 0.35; // Sandy shore
        }
      }

      if (dMountain < 120) {
        const t = Math.max(0, 1 - dMountain / 120);
        if (y > 25) {
          r = 0.85; g = 0.85; b = 0.9; // Snow
        } else if (y > 15) {
          r = 0.45 + t * 0.1; g = 0.4 + t * 0.1; b = 0.38; // Rock
        }
      }

      if (dForest < 90 && y > WATER_LEVEL + 2) {
        const t = Math.max(0, 1 - dForest / 90);
        r = 0.1 + t * 0.05; g = 0.3 + t * 0.15; b = 0.08; // Forest green
      }

      if (dVillage < 50 && y > WATER_LEVEL + 2) {
        const t = Math.max(0, 1 - dVillage / 50);
        r = 0.5 + t * 0.1; g = 0.45 + t * 0.05; b = 0.3; // Village brown
      }

      if (dCastle < 60 && y > WATER_LEVEL + 2) {
        const t = Math.max(0, 1 - dCastle / 60);
        r = 0.35 + t * 0.1; g = 0.3 + t * 0.05; b = 0.25; // Stone path
      }

      colors[i] = r;
      colors[i + 1] = g;
      colors[i + 2] = b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: false,
    });

    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    scene.add(terrain);

    // Water plane
    const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1a5276,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
      metalness: 0.3,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = WATER_LEVEL;
    scene.add(water);

    return { terrain, water };
  }, []);

  // ============================================================
  // CREATE MEDIEVAL STRUCTURES
  // ============================================================
  const createStructures = useCallback((scene: THREE.Scene) => {
    const structures: THREE.Group[] = [];
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.9 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x505050, roughness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7 });

    // ---- CASTLE ----
    const castle = new THREE.Group();
    // Main keep
    const keepGeo = new THREE.BoxGeometry(20, 25, 20);
    const keep = new THREE.Mesh(keepGeo, darkStoneMat);
    keep.position.set(80, 42, 60);
    keep.castShadow = true;
    castle.add(keep);

    // Keep top
    const keepTopGeo = new THREE.ConeGeometry(16, 8, 4);
    const keepTop = new THREE.Mesh(keepTopGeo, roofMat);
    keepTop.position.set(80, 58, 60);
    keepTop.rotation.y = Math.PI / 4;
    castle.add(keepTop);

    // Castle walls
    const wallPositions = [
      { x: 65, z: 45, w: 35, h: 12, d: 3 },
      { x: 95, z: 45, w: 35, h: 12, d: 3 },
      { x: 80, z: 35, w: 3, h: 12, d: 35 },
      { x: 80, z: 75, w: 3, h: 12, d: 35 },
    ];
    wallPositions.forEach(wp => {
      const wallGeo = new THREE.BoxGeometry(wp.w, wp.h, wp.d);
      const wall = new THREE.Mesh(wallGeo, stoneMat);
      wall.position.set(wp.x, wp.h / 2 + 28, wp.z);
      wall.castShadow = true;
      castle.add(wall);
    });

    // Corner towers
    const towerPositions = [
      { x: 65, z: 35 }, { x: 95, z: 35 },
      { x: 65, z: 75 }, { x: 95, z: 75 },
    ];
    towerPositions.forEach(tp => {
      const towerGeo = new THREE.CylinderGeometry(3, 3.5, 18, 8);
      const tower = new THREE.Mesh(towerGeo, darkStoneMat);
      tower.position.set(tp.x, 37, tp.z);
      tower.castShadow = true;
      castle.add(tower);
      const towerTopGeo = new THREE.ConeGeometry(4, 6, 8);
      const towerTop = new THREE.Mesh(towerTopGeo, roofMat);
      towerTop.position.set(tp.x, 49, tp.z);
      castle.add(towerTop);
    });

    scene.add(castle);
    structures.push(castle);

    // ---- VILLAGE ----
    const village = new THREE.Group();
    const housePositions = [
      { x: 15, z: -30 }, { x: 25, z: -25 }, { x: 10, z: -45 },
      { x: 30, z: -40 }, { x: 20, z: -55 }, { x: 35, z: -50 },
    ];
    housePositions.forEach(hp => {
      const house = new THREE.Group();
      const wallGeo = new THREE.BoxGeometry(6, 4, 6);
      const wall = new THREE.Mesh(wallGeo, woodMat);
      wall.position.y = 2;
      house.add(wall);
      const roofGeo = new THREE.ConeGeometry(5, 3, 4);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = 5.5;
      roof.rotation.y = Math.PI / 4;
      house.add(roof);
      house.position.set(hp.x, 0, hp.z);
      village.add(house);
    });

    // Church/tavern
    const churchGeo = new THREE.BoxGeometry(8, 7, 12);
    const church = new THREE.Mesh(churchGeo, stoneMat);
    church.position.set(22, 3.5, -35);
    village.add(church);
    const steepleGeo = new THREE.ConeGeometry(3, 8, 4);
    const steeple = new THREE.Mesh(steepleGeo, roofMat);
    steeple.position.set(22, 11, -35);
    village.add(steeple);

    scene.add(village);
    structures.push(village);

    // ---- FOREST TREES ----
    const forest = new THREE.Group();
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2d5016, roughness: 0.8 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2f0a, roughness: 0.9 });

    for (let i = 0; i < 200; i++) {
      const tree = new THREE.Group();
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 80;
      const tx = -60 + Math.cos(angle) * dist;
      const tz = 100 + Math.sin(angle) * dist;

      const trunkHeight = 4 + Math.random() * 4;
      const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, trunkHeight, 6);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = trunkHeight / 2;
      tree.add(trunk);

      const leafSize = 2 + Math.random() * 2;
      const leavesGeo = new THREE.ConeGeometry(leafSize, leafSize * 2.5, 6);
      const leaves = new THREE.Mesh(leavesGeo, treeMat);
      leaves.position.y = trunkHeight + leafSize;
      tree.add(leaves);

      tree.position.set(tx, 0, tz);
      tree.castShadow = true;
      forest.add(tree);
    }
    scene.add(forest);
    structures.push(forest);

    // ---- SCATTERED RUINS ----
    const ruins = new THREE.Group();
    const ruinPositions = [
      { x: -150, z: 0 }, { x: 0, z: 150 }, { x: -100, z: -150 },
      { x: 150, z: 50 },
    ];
    ruinPositions.forEach(rp => {
      const pillarGeo = new THREE.CylinderGeometry(1, 1.2, 8 + Math.random() * 4, 6);
      const pillar = new THREE.Mesh(pillarGeo, stoneMat);
      pillar.position.set(rp.x, 5, rp.z);
      pillar.rotation.z = Math.random() * 0.3 - 0.15;
      ruins.add(pillar);

      const blockGeo = new THREE.BoxGeometry(3 + Math.random() * 2, 2, 3 + Math.random() * 2);
      const block = new THREE.Mesh(blockGeo, stoneMat);
      block.position.set(rp.x + 5, 1, rp.z + 3);
      block.rotation.y = Math.random() * Math.PI;
      ruins.add(block);
    });
    scene.add(ruins);
    structures.push(ruins);

    return structures;
  }, []);

  // ============================================================
  // CREATE DRAGON MODEL
  // ============================================================
  const createDragon = useCallback((scene: THREE.Scene) => {
    const dragon = new THREE.Group();

    // Body materials
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2d1b0e, roughness: 0.6, metalness: 0.3 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 2 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.4 });
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.5 });

    // Body
    const bodyGeo = new THREE.SphereGeometry(1.5, 8, 6);
    bodyGeo.scale(1, 0.7, 1.8);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0, 0);
    body.castShadow = true;
    dragon.add(body);

    // Belly
    const bellyGeo = new THREE.SphereGeometry(1.2, 8, 6);
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
    const headGeo = new THREE.SphereGeometry(0.7, 8, 6);
    headGeo.scale(0.8, 0.7, 1.2);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 1.2, -3.2);
    head.castShadow = true;
    dragon.add(head);

    // Snout
    const snoutGeo = new THREE.ConeGeometry(0.4, 1.2, 6);
    const snout = new THREE.Mesh(snoutGeo, bodyMat);
    snout.position.set(0, 1.0, -4.2);
    snout.rotation.x = Math.PI / 2;
    dragon.add(snout);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.4, 1.5, -3.5);
    dragon.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.4, 1.5, -3.5);
    dragon.add(rightEye);

    // Horns
    const hornGeo = new THREE.ConeGeometry(0.15, 1.5, 6);
    const leftHorn = new THREE.Mesh(hornGeo, hornMat);
    leftHorn.position.set(-0.4, 2.0, -3.0);
    leftHorn.rotation.x = -0.3;
    leftHorn.rotation.z = 0.3;
    dragon.add(leftHorn);
    const rightHorn = new THREE.Mesh(hornGeo, hornMat);
    rightHorn.position.set(0.4, 2.0, -3.0);
    rightHorn.rotation.x = -0.3;
    rightHorn.rotation.z = -0.3;
    dragon.add(rightHorn);

    // Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1, 0.5);
    wingShape.lineTo(3, 1.5);
    wingShape.lineTo(4, 1);
    wingShape.lineTo(3.5, 0.3);
    wingShape.lineTo(2, -0.3);
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
    const boneGeo = new THREE.CylinderGeometry(0.05, 0.08, 3, 4);
    const boneMat2 = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
    const leftBone = new THREE.Mesh(boneGeo, boneMat2);
    leftBone.position.set(2.5, 0.8, -0.3);
    leftBone.rotation.z = Math.PI / 4;
    dragon.add(leftBone);
    const rightBone = new THREE.Mesh(boneGeo, boneMat2);
    rightBone.position.set(-2.5, 0.8, -0.3);
    rightBone.rotation.z = -Math.PI / 4;
    dragon.add(rightBone);

    // Tail
    const tailSegments = 8;
    for (let i = 0; i < tailSegments; i++) {
      const t = i / tailSegments;
      const radius = 0.6 * (1 - t * 0.8);
      const segGeo = new THREE.SphereGeometry(radius, 6, 4);
      const seg = new THREE.Mesh(segGeo, bodyMat);
      seg.position.set(0, -0.2 + t * 0.5, 1.5 + i * 0.8);
      seg.castShadow = true;
      dragon.add(seg);
    }

    // Tail spike
    const tailSpikeGeo = new THREE.ConeGeometry(0.3, 1, 6);
    const tailSpike = new THREE.Mesh(tailSpikeGeo, spikeMat);
    tailSpike.position.set(0, 1.5, 1.5 + tailSegments * 0.8);
    tailSpike.rotation.x = Math.PI / 2;
    dragon.add(tailSpike);

    // Back spikes
    for (let i = 0; i < 6; i++) {
      const spikeGeo2 = new THREE.ConeGeometry(0.1, 0.5, 4);
      const spike = new THREE.Mesh(spikeGeo2, spikeMat);
      spike.position.set(0, 1.0 - i * 0.05, -1.5 + i * 0.6);
      dragon.add(spike);
    }

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6);
    const clawGeo = new THREE.ConeGeometry(0.25, 0.4, 4);
    const legPositions = [
      { x: 0.8, z: -0.5 }, { x: -0.8, z: -0.5 },
      { x: 0.8, z: 1.0 }, { x: -0.8, z: 1.0 },
    ];
    legPositions.forEach(lp => {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(lp.x, -1.0, lp.z);
      leg.castShadow = true;
      dragon.add(leg);
      const claw = new THREE.Mesh(clawGeo, bodyMat);
      claw.position.set(lp.x, -1.8, lp.z);
      claw.rotation.x = Math.PI;
      dragon.add(claw);
    });

    // Fire light (attached to dragon)
    const fireLight = new THREE.PointLight(0xff4400, 0, 20);
    fireLight.position.set(0, 1.0, -4.5);
    dragon.add(fireLight);

    dragon.position.set(0, 15, 0);
    dragon.castShadow = true;
    scene.add(dragon);

    return dragon;
  }, []);

  // ============================================================
  // CREATE ENEMY
  // ============================================================
  const createEnemyMesh = useCallback((type: 'archer' | 'catapult' | 'dragon', position: THREE.Vector3): { mesh: THREE.Group; health: number; speed: number; attackCooldown: number; attackRange: number; damage: number } => {
    const group = new THREE.Group();

    if (type === 'archer') {
      // Archer figure
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.7 });
      const bowMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6 });

      // Body
      const bodyGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.5, 6);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.75;
      group.add(body);

      // Head
      const headGeo = new THREE.SphereGeometry(0.25, 6, 6);
      const head = new THREE.Mesh(headGeo, skinMat);
      head.position.y = 1.75;
      group.add(head);

      // Helmet
      const helmetGeo = new THREE.SphereGeometry(0.3, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      const helmet = new THREE.Mesh(helmetGeo, new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5 }));
      helmet.position.y = 1.85;
      group.add(helmet);

      // Bow
      const bowGeo = new THREE.TorusGeometry(0.5, 0.03, 4, 12, Math.PI);
      const bow = new THREE.Mesh(bowGeo, bowMat);
      bow.position.set(0.5, 1.2, 0);
      bow.rotation.z = Math.PI / 2;
      group.add(bow);

      group.position.copy(position);
      return { mesh: group, health: 30, speed: 2, attackCooldown: 2, attackRange: 80, damage: 8 };
    }

    if (type === 'catapult') {
      // Catapult siege weapon
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6B3410, roughness: 0.8 });
      const metalMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.4 });

      // Base
      const baseGeo = new THREE.BoxGeometry(3, 1, 2);
      const base = new THREE.Mesh(baseGeo, woodMat);
      base.position.y = 0.5;
      group.add(base);

      // Wheels
      const wheelGeo = new THREE.TorusGeometry(0.5, 0.15, 6, 12);
      [-1.2, 1.2].forEach(x => {
        const wheel = new THREE.Mesh(wheelGeo, woodMat);
        wheel.position.set(x, 0.5, 1.2);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      });

      // Arm
      const armGeo = new THREE.BoxGeometry(0.3, 4, 0.3);
      const arm = new THREE.Mesh(armGeo, woodMat);
      arm.position.set(0, 2.5, -0.3);
      arm.rotation.x = -0.5;
      group.add(arm);

      // Bucket
      const bucketGeo = new THREE.BoxGeometry(1, 0.5, 0.8);
      const bucket = new THREE.Mesh(bucketGeo, metalMat);
      bucket.position.set(0, 4, -1.5);
      group.add(bucket);

      group.position.copy(position);
      return { mesh: group, health: 80, speed: 0, attackCooldown: 4, attackRange: 120, damage: 25 };
    }

    if (type === 'dragon') {
      // Enemy dragon (red/dark)
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.5, metalness: 0.3 });
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x5a0000, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 });

      // Body
      const bodyGeo = new THREE.SphereGeometry(1.8, 8, 6);
      bodyGeo.scale(1, 0.7, 1.8);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.castShadow = true;
      group.add(body);

      // Head
      const headGeo = new THREE.SphereGeometry(0.8, 8, 6);
      headGeo.scale(0.8, 0.7, 1.2);
      const head = new THREE.Mesh(headGeo, bodyMat);
      head.position.set(0, 0.8, -3.5);
      head.castShadow = true;
      group.add(head);

      // Snout
      const snoutGeo = new THREE.ConeGeometry(0.5, 1.5, 6);
      const snout = new THREE.Mesh(snoutGeo, bodyMat);
      snout.position.set(0, 0.6, -4.8);
      snout.rotation.x = Math.PI / 2;
      group.add(snout);

      // Eyes
      const eyeGeo = new THREE.SphereGeometry(0.18, 8, 8);
      [-0.5, 0.5].forEach(x => {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(x, 1.2, -3.8);
        group.add(eye);
      });

      // Wings
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.lineTo(1, 0.5);
      wingShape.lineTo(3.5, 2);
      wingShape.lineTo(5, 1.5);
      wingShape.lineTo(4, 0.5);
      wingShape.lineTo(2, -0.3);
      wingShape.lineTo(0.5, -0.5);
      wingShape.lineTo(0, 0);
      const wingGeo = new THREE.ShapeGeometry(wingShape);

      const leftWing = new THREE.Mesh(wingGeo, wingMat);
      leftWing.position.set(1.2, 0.5, -0.5);
      leftWing.rotation.y = Math.PI / 2;
      leftWing.name = 'leftWing';
      group.add(leftWing);

      const rightWing = new THREE.Mesh(wingGeo, wingMat);
      rightWing.position.set(-1.2, 0.5, -0.5);
      rightWing.rotation.y = -Math.PI / 2;
      rightWing.name = 'rightWing';
      group.add(rightWing);

      // Tail
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const radius = 0.7 * (1 - t * 0.8);
        const segGeo = new THREE.SphereGeometry(radius, 6, 4);
        const seg = new THREE.Mesh(segGeo, bodyMat);
        seg.position.set(0, -0.2 + t * 0.3, 1.5 + i * 1.0);
        group.add(seg);
      }

      // Fire light
      const fireLight = new THREE.PointLight(0xff0000, 0, 15);
      fireLight.position.set(0, 0.8, -5);
      group.add(fireLight);

      group.position.copy(position);
      const isKing = position.y > 30;
      return {
        mesh: group,
        health: isKing ? 300 : 120,
        speed: isKing ? 12 : 8,
        attackCooldown: isKing ? 1.5 : 2.5,
        attackRange: isKing ? 60 : 45,
        damage: isKing ? 20 : 12,
      };
    }

    return { mesh: group, health: 50, speed: 3, attackCooldown: 2, attackRange: 50, damage: 10 };
  }, []);

  // ============================================================
  // SPAWN ENEMIES
  // ============================================================
  const spawnEnemies = useCallback((scene: THREE.Scene) => {
    const enemies: Enemy[] = [];

    // Mission 1: Archers on eastern hills
    const archerPositions = [
      new THREE.Vector3(150, 10, -30),
      new THREE.Vector3(160, 12, -20),
      new THREE.Vector3(145, 8, -40),
      new THREE.Vector3(170, 11, -25),
      new THREE.Vector3(155, 9, -35),
    ];
    archerPositions.forEach(pos => {
      const data = createEnemyMesh('archer', pos);
      scene.add(data.mesh);
      enemies.push({
        ...data,
        type: 'archer',
        maxHealth: data.health,
        alive: true,
        position: pos.clone(),
        patrolAngle: Math.random() * Math.PI * 2,
        fireTimer: 0,
      });
    });

    // More archers on castle walls (mission 4)
    const castleArcherPositions = [
      new THREE.Vector3(80, 42, 35),
      new THREE.Vector3(65, 42, 55),
      new THREE.Vector3(95, 42, 55),
      new THREE.Vector3(80, 42, 75),
      new THREE.Vector3(70, 42, 70),
      new THREE.Vector3(90, 42, 40),
      new THREE.Vector3(75, 42, 38),
      new THREE.Vector3(85, 42, 72),
    ];
    castleArcherPositions.forEach(pos => {
      const data = createEnemyMesh('archer', pos);
      scene.add(data.mesh);
      enemies.push({
        ...data,
        type: 'archer',
        maxHealth: data.health,
        alive: true,
        position: pos.clone(),
        patrolAngle: Math.random() * Math.PI * 2,
        fireTimer: 0,
      });
    });

    // Mission 2: Rival dragon in mountains
    const rivalDragonPos = new THREE.Vector3(100, 40, -100);
    const dragonData = createEnemyMesh('dragon', rivalDragonPos);
    scene.add(dragonData.mesh);
    enemies.push({
      ...dragonData,
      type: 'dragon',
      maxHealth: dragonData.health,
      alive: true,
      position: rivalDragonPos.clone(),
      patrolAngle: 0,
      fireTimer: 0,
    });

    // Mission 3: Catapults near castle
    const catapultPositions = [
      new THREE.Vector3(110, 30, 60),
      new THREE.Vector3(50, 30, 65),
      new THREE.Vector3(80, 30, 90),
    ];
    catapultPositions.forEach(pos => {
      const data = createEnemyMesh('catapult', pos);
      scene.add(data.mesh);
      enemies.push({
        ...data,
        type: 'catapult',
        maxHealth: data.health,
        alive: true,
        position: pos.clone(),
        patrolAngle: 0,
        fireTimer: 0,
      });
    });

    // Mission 5: Dragon King
    const kingPos = new THREE.Vector3(0, 50, 0);
    const kingData = createEnemyMesh('dragon', kingPos);
    kingData.mesh.scale.set(2, 2, 2);
    scene.add(kingData.mesh);
    enemies.push({
      ...kingData,
      type: 'dragon',
      maxHealth: kingData.health,
      alive: true,
      position: kingPos.clone(),
      patrolAngle: 0,
      fireTimer: 0,
    });

    return enemies;
  }, [createEnemyMesh]);

  // ============================================================
  // GET TERRAIN HEIGHT
  // ============================================================
  const getTerrainHeight = useCallback((x: number, z: number, terrain: THREE.Mesh): number => {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, 200, z),
      new THREE.Vector3(0, -1, 0)
    );
    const intersects = raycaster.intersectObject(terrain);
    if (intersects.length > 0) {
      return intersects[0].point.y;
    }
    return 0;
  }, []);

  // ============================================================
  // FIRE BREATH
  // ============================================================
  const breatheFire = useCallback(() => {
    const game = gameRef.current;
    if (!game || game.stats.stamina < 5) return;

    game.isBreathingFire = true;
    game.stats.stamina -= 5;

    const dragonDir = new THREE.Vector3(0, 0, -1);
    dragonDir.applyQuaternion(game.dragon.quaternion);

    const dragonPos = game.dragon.position.clone();
    dragonPos.add(dragonDir.clone().multiplyScalar(3));
    dragonPos.y += 1;

    // Fire light
    game.fireLight.intensity = 3;

    for (let i = 0; i < 5; i++) {
      const fireGeo = new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 4, 4);
      const fireMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.05 + Math.random() * 0.08, 1, 0.5 + Math.random() * 0.3),
        transparent: true,
        opacity: 0.9,
      });
      const fireMesh = new THREE.Mesh(fireGeo, fireMat);
      fireMesh.position.copy(dragonPos);

      const spread = 0.3;
      const vel = dragonDir.clone().multiplyScalar(30 + Math.random() * 20);
      vel.x += (Math.random() - 0.5) * spread * 30;
      vel.y += (Math.random() - 0.5) * spread * 20;
      vel.z += (Math.random() - 0.5) * spread * 30;

      game.scene.add(fireMesh);
      game.fireParticles.push({
        mesh: fireMesh,
        velocity: vel,
        lifetime: 0.8 + Math.random() * 0.4,
        maxLifetime: 1.2,
      });
    }
  }, []);

  // ============================================================
  // ENEMY FIRE BREATH (for enemy dragons)
  // ============================================================
  const enemyBreatheFire = useCallback((enemy: Enemy) => {
    const game = gameRef.current;
    if (!game) return;

    const dir = new THREE.Vector3();
    dir.subVectors(game.dragon.position, enemy.mesh.position).normalize();

    const pos = enemy.mesh.position.clone();
    pos.add(dir.clone().multiplyScalar(3));
    pos.y += 0.8;

    for (let i = 0; i < 4; i++) {
      const fireGeo = new THREE.SphereGeometry(0.3 + Math.random() * 0.2, 4, 4);
      const fireMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.02, 1, 0.5 + Math.random() * 0.3),
        transparent: true,
        opacity: 0.9,
      });
      const fireMesh = new THREE.Mesh(fireGeo, fireMat);
      fireMesh.position.copy(pos);

      const vel = dir.clone().multiplyScalar(25 + Math.random() * 15);
      vel.x += (Math.random() - 0.5) * 10;
      vel.y += (Math.random() - 0.5) * 8;
      vel.z += (Math.random() - 0.5) * 10;

      game.scene.add(fireMesh);
      game.fireParticles.push({
        mesh: fireMesh,
        velocity: vel,
        lifetime: 0.6 + Math.random() * 0.3,
        maxLifetime: 0.9,
      });
    }
  }, []);

  // ============================================================
  // ENEMY SHOOT ARROW
  // ============================================================
  const shootArrow = useCallback((enemy: Enemy) => {
    const game = gameRef.current;
    if (!game) return;

    const dir = new THREE.Vector3();
    dir.subVectors(game.dragon.position, enemy.mesh.position).normalize();

    const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 4);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.copy(enemy.mesh.position);
    arrow.position.y += 2;

    // Orient arrow towards dragon
    arrow.lookAt(game.dragon.position);
    arrow.rotateX(Math.PI / 2);

    game.scene.add(arrow);
    game.projectiles.push({
      mesh: arrow,
      velocity: dir.clone().multiplyScalar(50),
      damage: enemy.damage,
      lifetime: 3,
      fromEnemy: true,
    });
  }, []);

  // ============================================================
  // ENEMY SHOOT ROCK (catapult)
  // ============================================================
  const shootRock = useCallback((enemy: Enemy) => {
    const game = gameRef.current;
    if (!game) return;

    const dir = new THREE.Vector3();
    dir.subVectors(game.dragon.position, enemy.mesh.position).normalize();

    const rockGeo = new THREE.SphereGeometry(0.8, 6, 6);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.9 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.copy(enemy.mesh.position);
    rock.position.y += 4;

    const vel = dir.clone().multiplyScalar(35);
    vel.y += 15; // Arc

    game.scene.add(rock);
    game.projectiles.push({
      mesh: rock,
      velocity: vel,
      damage: enemy.damage,
      lifetime: 5,
      fromEnemy: true,
    });
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
    game.dayTime += delta * 0.02;
    const sunAngle = game.dayTime;
    game.sunLight.position.set(Math.cos(sunAngle) * 200, Math.sin(sunAngle) * 150 + 50, 50);
    const sunIntensity = Math.max(0.2, Math.sin(sunAngle) * 0.5 + 0.5);
    game.sunLight.intensity = sunIntensity;
    game.ambientLight.intensity = 0.2 + sunIntensity * 0.3;
    const fogDensity = 0.002 + (1 - sunIntensity) * 0.003;
    game.scene.fog = new THREE.FogExp2(game.fogColor, fogDensity);

    // ---- Dragon Movement ----
    const dragon = game.dragon;
    const keys = game.keys;
    const moveSpeed = 20 * delta;
    const flySpeed = 30 * delta;
    const turnSpeed = 2.0 * delta;

    // Rotation
    if (keys.has('a') || keys.has('arrowleft')) game.yaw += turnSpeed;
    if (keys.has('d') || keys.has('arrowright')) game.yaw -= turnSpeed;
    if (keys.has('w') || keys.has('arrowup')) game.pitch = Math.max(game.pitch - turnSpeed * 0.5, -1.2);
    if (keys.has('s') || keys.has('arrowdown')) game.pitch = Math.min(game.pitch + turnSpeed * 0.5, 1.0);

    // Apply rotation
    dragon.rotation.set(0, 0, 0);
    dragon.rotateY(game.yaw);
    dragon.rotateX(game.pitch);

    // Forward direction
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(dragon.quaternion);

    // Movement
    const isMovingForward = keys.has('w') || keys.has('arrowup');
    const isMovingBackward = keys.has('s') || keys.has('arrowdown');
    const isAscending = keys.has(' ');
    const isDescending = keys.has('shift');

    if (isMovingForward) {
      if (game.isFlying) {
        dragon.position.add(forward.clone().multiplyScalar(flySpeed));
        game.stats.stamina -= delta * 3;
      } else {
        const flatForward = new THREE.Vector3(forward.x, 0, forward.z).normalize();
        dragon.position.add(flatForward.multiplyScalar(moveSpeed));
      }
    }
    if (isMovingBackward) {
      if (game.isFlying) {
        dragon.position.add(forward.clone().multiplyScalar(-flySpeed * 0.5));
      } else {
        const flatForward = new THREE.Vector3(forward.x, 0, forward.z).normalize();
        dragon.position.add(flatForward.multiplyScalar(-moveSpeed * 0.5));
      }
    }

    // Flying
    if (isAscending && game.stats.stamina > 0) {
      game.isFlying = true;
      dragon.position.y += flySpeed * 1.5;
      game.stats.stamina -= delta * 5;
      game.isGrounded = false;
    }
    if (isDescending) {
      if (game.isFlying) {
        dragon.position.y -= flySpeed * 2;
      }
    }

    // Dive attack
    if (game.isDiving && game.isFlying) {
      game.diveVelocity.add(forward.clone().multiplyScalar(delta * 80));
      game.diveVelocity.y -= delta * 40;
      dragon.position.add(game.diveVelocity.clone().multiplyScalar(delta));
    }

    // Gravity & ground collision
    const terrainHeight = getTerrainHeight(dragon.position.x, dragon.position.z, game.terrain);
    const groundLevel = Math.max(terrainHeight + 2, WATER_LEVEL + 2);

    if (!game.isFlying && !game.isDiving) {
      if (dragon.position.y > groundLevel) {
        game.dragonVelocity.y -= 20 * delta;
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
    }

    // Wing animation
    if (game.isFlying || isAscending) {
      game.wingAngle += game.wingDir * delta * 8;
      if (game.wingAngle > 0.8 || game.wingAngle < -0.2) game.wingDir *= -1;
    } else {
      game.wingAngle = 0.3;
    }

    dragon.traverse(child => {
      if (child.name === 'leftWing') {
        child.rotation.z = game.wingAngle;
      }
      if (child.name === 'rightWing') {
        child.rotation.z = -game.wingAngle;
      }
    });

    // Stamina & hunger regen
    game.staminaRegenTimer += delta;
    if (game.staminaRegenTimer > 0.5) {
      game.staminaRegenTimer = 0;
      if (game.isGrounded) {
        game.stats.stamina = Math.min(game.stats.maxStamina, game.stats.stamina + 3);
      } else {
        game.stats.stamina = Math.min(game.stats.maxStamina, game.stats.stamina + 0.5);
      }
    }

    game.hungerTimer += delta;
    if (game.hungerTimer > 5) {
      game.hungerTimer = 0;
      game.stats.hunger = Math.max(0, game.stats.hunger - 2);
      if (game.stats.hunger <= 0) {
        game.stats.health -= 3;
      }
    }

    // Fire breath
    if (game.isBreathingFire) {
      game.fireBreathTimer += delta;
      if (game.fireBreathTimer > 0.1) {
        game.fireBreathTimer = 0;
        breatheFire();
      }
    }
    if (!game.mouse.down) {
      game.isBreathingFire = false;
      game.fireLight.intensity *= 0.9;
    }

    // Dive attack check
    if (game.mouse.rightDown && game.isFlying && !game.isDiving) {
      game.isDiving = true;
      game.diveVelocity = forward.clone().multiplyScalar(30);
      game.diveVelocity.y = -15;
    }

    // ---- Camera ----
    const cameraDistance = 18;
    const cameraHeight = 8;
    const idealOffset = new THREE.Vector3(0, cameraHeight, cameraDistance);
    idealOffset.applyQuaternion(dragon.quaternion);
    idealOffset.add(dragon.position);

    const idealLookAt = new THREE.Vector3(0, 2, -10);
    idealLookAt.applyQuaternion(dragon.quaternion);
    idealLookAt.add(dragon.position);

    game.camera.position.lerp(idealOffset, 5 * delta);
    const currentLookAt = new THREE.Vector3();
    game.camera.getWorldDirection(currentLookAt);
    game.camera.lookAt(idealLookAt);

    // ---- Enemies ----
    game.enemies.forEach(enemy => {
      if (!enemy.alive) return;

      enemy.fireTimer += delta;

      if (enemy.type === 'dragon') {
        // Dragon AI - fly around and attack
        enemy.patrolAngle += delta * 0.5;

        const distToPlayer = enemy.mesh.position.distanceTo(dragon.position);

        if (distToPlayer < 100) {
          // Chase player
          const toPlayer = new THREE.Vector3();
          toPlayer.subVectors(dragon.position, enemy.mesh.position).normalize();

          enemy.mesh.position.add(toPlayer.multiplyScalar(enemy.speed * delta));
          enemy.mesh.lookAt(dragon.position);

          if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
            enemy.fireTimer = 0;
            enemyBreatheFire(enemy);
          }
        } else {
          // Patrol
          const patrolRadius = 40;
          const centerX = enemy.type === 'dragon' && enemy.health > 200 ? 0 : 100;
          const centerZ = enemy.type === 'dragon' && enemy.health > 200 ? 0 : -100;
          enemy.mesh.position.x = centerX + Math.cos(enemy.patrolAngle) * patrolRadius;
          enemy.mesh.position.z = centerZ + Math.sin(enemy.patrolAngle) * patrolRadius;
          enemy.mesh.position.y = 35 + Math.sin(enemy.patrolAngle * 2) * 10;
          enemy.mesh.rotation.y = enemy.patrolAngle + Math.PI / 2;
        }

        // Wing animation for enemy dragons
        const eWingAngle = Math.sin(enemy.patrolAngle * 4) * 0.5;
        enemy.mesh.traverse(child => {
          if (child.name === 'leftWing') child.rotation.z = eWingAngle;
          if (child.name === 'rightWing') child.rotation.z = -eWingAngle;
        });

      } else if (enemy.type === 'archer') {
        const distToPlayer = enemy.mesh.position.distanceTo(dragon.position);
        if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
          enemy.fireTimer = 0;
          enemy.mesh.lookAt(dragon.position);
          shootArrow(enemy);
        }
        // Face player when nearby
        if (distToPlayer < enemy.attackRange) {
          enemy.mesh.lookAt(dragon.position);
        }
      } else if (enemy.type === 'catapult') {
        const distToPlayer = enemy.mesh.position.distanceTo(dragon.position);
        if (distToPlayer < enemy.attackRange && enemy.fireTimer > enemy.attackCooldown) {
          enemy.fireTimer = 0;
          shootRock(enemy);
        }
        if (distToPlayer < enemy.attackRange) {
          enemy.mesh.lookAt(dragon.position);
        }
      }
    });

    // ---- Projectiles ----
    game.projectiles = game.projectiles.filter(proj => {
      proj.lifetime -= delta;
      if (proj.lifetime <= 0) {
        game.scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        return false;
      }

      proj.mesh.position.add(proj.velocity.clone().multiplyScalar(delta));
      if (!proj.fromEnemy) {
        proj.velocity.y -= 10 * delta;
      }

      // Check collision with dragon (from enemy projectiles)
      if (proj.fromEnemy) {
        const dist = proj.mesh.position.distanceTo(dragon.position);
        if (dist < 3 * game.dragonScale) {
          game.stats.health -= proj.damage;
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
      if (particle.lifetime <= 0) {
        game.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        return false;
      }

      particle.mesh.position.add(particle.velocity.clone().multiplyScalar(delta));
      particle.velocity.y += 5 * delta;
      const lifeRatio = particle.lifetime / particle.maxLifetime;
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = lifeRatio;
      particle.mesh.scale.setScalar(lifeRatio);

      // Check collision with enemies
      for (const enemy of game.enemies) {
        if (!enemy.alive) continue;
        const dist = particle.mesh.position.distanceTo(enemy.mesh.position);
        if (dist < 3) {
          enemy.health -= 15;
          if (enemy.health <= 0) {
            enemy.alive = false;
            game.scene.remove(enemy.mesh);
            game.stats.xp += enemy.type === 'dragon' ? 50 : enemy.type === 'catapult' ? 30 : 15;
            game.stats.hunger = Math.min(game.stats.maxHunger, game.stats.hunger + 10);

            // Level up check
            if (game.stats.xp >= game.stats.xpToNext) {
              game.stats.level++;
              game.stats.xp -= game.stats.xpToNext;
              game.stats.xpToNext = Math.floor(game.stats.xpToNext * 1.5);
              game.stats.maxHealth += 10;
              game.stats.health = game.stats.maxHealth;
              game.stats.maxStamina += 10;
              game.stats.stamina = game.stats.maxStamina;
              game.dragonScale = 1 + game.stats.level * 0.1;
              dragon.scale.setScalar(game.dragonScale);
              showNotification(`Level Up! You are now level ${game.stats.level}!`);
            }

            // Update mission progress
            const missions = game.missions;
            const mi = game.missionIndex;
            if (mi < missions.length && !missions[mi].completed) {
              const mission = missions[mi];
              // Check if this enemy type matches current mission
              let matches = false;
              if (mi === 0 && enemy.type === 'archer' && enemy.mesh.position.x > 100) matches = true;
              if (mi === 1 && enemy.type === 'dragon' && enemy.health < 200) matches = true;
              if (mi === 2 && enemy.type === 'catapult') matches = true;
              if (mi === 3 && enemy.type === 'archer' && enemy.mesh.position.x < 100) matches = true;
              if (mi === 4 && enemy.type === 'dragon' && enemy.health >= 200) matches = true;

              if (matches) {
                mission.currentCount++;
                if (mission.currentCount >= mission.targetCount) {
                  mission.completed = true;
                  showNotification(`Mission Complete: ${mission.title}!`);
                  if (mi < missions.length - 1) {
                    game.missionIndex = mi + 1;
                  }
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

    // ---- Dive attack damage ----
    if (game.isDiving && game.isGrounded) {
      game.isDiving = false;
      game.diveVelocity.set(0, 0, 0);
      // AoE damage on landing
      game.enemies.forEach(enemy => {
        if (!enemy.alive) return;
        const dist = enemy.mesh.position.distanceTo(dragon.position);
        if (dist < 15) {
          enemy.health -= 40;
          if (enemy.health <= 0) {
            enemy.alive = false;
            game.scene.remove(enemy.mesh);
            game.stats.xp += 20;
          }
        }
      });
    }

    // ---- Territory check ----
    game.territories.forEach(terr => {
      const dist = dragon.position.distanceTo(terr.center);
      if (dist < terr.radius) {
        const enemiesInArea = game.enemies.filter(e => e.alive && e.mesh.position.distanceTo(terr.center) < terr.radius);
        if (enemiesInArea.length === 0 && !terr.controlled) {
          terr.controlled = true;
          game.stats.territory++;
          showNotification(`Territory Claimed: ${terr.name}!`);
        }
      }
    });

    // ---- Clamp position ----
    const boundary = TERRAIN_SIZE / 2 - 20;
    dragon.position.x = Math.max(-boundary, Math.min(boundary, dragon.position.x));
    dragon.position.z = Math.max(-boundary, Math.min(boundary, dragon.position.z));
    if (dragon.position.y > 150) dragon.position.y = 150;

    // ---- Update React state ----
    setStats({ ...game.stats });
    if (game.missionIndex < game.missions.length) {
      const mission = game.missions[game.missionIndex];
      if (!mission.completed) {
        setCurrentMission({ ...mission });
      } else if (game.missionIndex === game.missions.length - 1) {
        setGameState('victory');
        game.gameActive = false;
      }
    }

    // ---- Notification timer ----
    if (game.notificationTimer > 0) {
      game.notificationTimer -= delta;
      if (game.notificationTimer <= 0) {
        setNotification('');
      }
    }

    // ---- Death check ----
    if (game.stats.health <= 0) {
      game.stats.health = 0;
      setGameState('gameover');
      game.gameActive = false;
    }

    // ---- Render ----
    game.renderer.render(game.scene, game.camera);
    game.animationId = requestAnimationFrame(() => gameLoopRef.current());
  }, [breatheFire, enemyBreatheFire, getTerrainHeight, shootArrow, shootRock, showNotification]);

  // Keep ref updated
  useEffect(() => {
    gameLoopRef.current = gameLoop;
  }, [gameLoop]);

  // ============================================================
  // INITIALIZE GAME
  // ============================================================
  const initGame = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // Scene
    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x4a5568);
    scene.fog = new THREE.FogExp2(fogColor, 0.003);
    scene.background = fogColor;

    // Camera
    const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 20, 25);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404050, 0.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
    sunLight.position.set(100, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -200;
    sunLight.shadow.camera.right = 200;
    sunLight.shadow.camera.top = 200;
    sunLight.shadow.camera.bottom = -200;
    scene.add(sunLight);

    // Hemisphere light for atmosphere
    const hemiLight = new THREE.HemisphereLight(0x6688aa, 0x443322, 0.4);
    scene.add(hemiLight);

    // Terrain
    const { terrain, water } = generateTerrain(scene);

    // Structures
    const structures = createStructures(scene);

    // Dragon
    const dragon = createDragon(scene);

    // Enemies
    const enemies = spawnEnemies(scene);

    // Particle effects - atmospheric
    const particleCount = 500;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 400;
      particlePositions[i + 1] = Math.random() * 50 + 5;
      particlePositions[i + 2] = (Math.random() - 0.5) * 400;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 0.5,
      transparent: true,
      opacity: 0.3,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Fire light ref
    const fireLight = dragon.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight;

    // Territories
    const territories: Territory[] = [
      { name: 'Eastern Hills', center: new THREE.Vector3(155, 0, -30), radius: 50, controlled: false, enemyCount: 5, enemiesDefeated: 0 },
      { name: 'Northern Mountains', center: new THREE.Vector3(100, 0, -100), radius: 60, controlled: false, enemyCount: 1, enemiesDefeated: 0 },
      { name: 'Castle Gate', center: new THREE.Vector3(80, 0, 60), radius: 50, controlled: false, enemyCount: 3, enemiesDefeated: 0 },
      { name: 'Castle Interior', center: new THREE.Vector3(80, 0, 55), radius: 30, controlled: false, enemyCount: 8, enemiesDefeated: 0 },
      { name: 'Central Plains', center: new THREE.Vector3(0, 0, 0), radius: 40, controlled: false, enemyCount: 1, enemiesDefeated: 0 },
    ];

    // Missions
    const missions = createMissions();

    // Game state
    const game = {
      scene,
      camera,
      renderer,
      dragon,
      dragonMixer: null,
      clock: new THREE.Clock(),
      keys: new Set<string>(),
      mouse: { x: 0, y: 0, down: false, rightDown: false },
      stats: {
        health: 100, maxHealth: 100,
        stamina: 100, maxStamina: 100,
        hunger: 100, maxHunger: 100,
        xp: 0, level: 1, xpToNext: 100,
        territory: 0,
      },
      enemies,
      projectiles: [],
      fireParticles: [],
      missions,
      missionIndex: 0,
      territories,
      isGrounded: true,
      isFlying: false,
      isBreathingFire: false,
      isDiving: false,
      diveVelocity: new THREE.Vector3(),
      dragonVelocity: new THREE.Vector3(),
      cameraOffset: new THREE.Vector3(0, 8, 18),
      cameraLookOffset: new THREE.Vector3(0, 2, -10),
      animationId: 0,
      terrain,
      water,
      yaw: 0,
      pitch: 0,
      wingAngle: 0.3,
      wingDir: 1,
      hungerTimer: 0,
      staminaRegenTimer: 0,
      fireBreathTimer: 0,
      notificationTimer: 0,
      dragonScale: 1,
      gameActive: true,
      dayTime: Math.PI / 4,
      sunLight,
      ambientLight,
      fogColor,
      structures,
      arrowCooldown: 0,
      minimapCanvas: null,
      fireLight,
    };

    gameRef.current = game;

    // Set initial mission state via timeout to avoid effect setState lint
    setTimeout(() => {
      setMissionIndex(0);
      setCurrentMission(missions[0]);
    }, 0);

    // Input handlers
    const onKeyDown = (e: KeyboardEvent) => {
      game.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') {
        setGameState(prev => prev === 'playing' ? 'paused' : 'playing');
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowControls(prev => !prev);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      game.keys.delete(e.key.toLowerCase());
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) game.mouse.down = true;
      if (e.button === 2) game.mouse.rightDown = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) game.mouse.down = false;
      if (e.button === 2) game.mouse.rightDown = false;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
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
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);

    // Start game loop
    game.animationId = requestAnimationFrame(() => gameLoopRef.current());

    // Cleanup
    return () => {
      game.gameActive = false;
      cancelAnimationFrame(game.animationId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [createDragon, createMissions, createStructures, generateTerrain, spawnEnemies]);

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
          <p className="text-amber-200/60 animate-pulse">Loading the kingdom...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen relative overflow-hidden bg-black" ref={containerRef}>
      {/* ---- MENU SCREEN ---- */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 via-gray-800 to-red-950">
          <div className="text-center">
            <h1 className="text-6xl font-bold text-amber-500 mb-2 tracking-wider" style={{ textShadow: '0 0 30px rgba(217,119,6,0.5)' }}>
              DRAGON&apos;S REIGN
            </h1>
            <p className="text-xl text-amber-200/70 mb-1">Medieval Survival</p>
            <p className="text-sm text-gray-400 mb-10">Control the dragon. Conquer the kingdom.</p>

            <button
              onClick={() => setGameState('playing')}
              className="px-12 py-4 bg-red-800 hover:bg-red-700 text-amber-100 text-xl font-bold rounded-lg border-2 border-amber-600/50 shadow-lg shadow-red-900/50 transition-all hover:scale-105 hover:shadow-red-700/50 mb-6"
            >
              BEGIN CONQUEST
            </button>

            <div className="mt-8 text-gray-400 text-sm space-y-1">
              <p>WASD / Arrows - Move | Space - Fly Up | Shift - Fly Down</p>
              <p>Left Click - Fire Breath | Right Click - Dive Attack</p>
              <p>Tab - Controls | Esc - Pause</p>
            </div>
          </div>

          {/* Decorative fire particles */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-red-900/30 to-transparent" />
        </div>
      )}

      {/* ---- HUD ---- */}
      {gameState === 'playing' && (
        <>
          {/* Stats Panel */}
          <div className="absolute top-4 left-4 z-30 space-y-2 min-w-[220px]">
            {/* Health */}
            <div className="bg-black/70 rounded-lg p-2 backdrop-blur-sm border border-red-900/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-red-400 text-xs font-bold">HEALTH</span>
                <span className="text-red-300 text-xs">{Math.round(stats.health)}/{stats.maxHealth}</span>
              </div>
              <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-red-700 to-red-500 rounded-full transition-all" style={{ width: `${(stats.health / stats.maxHealth) * 100}%` }} />
              </div>
            </div>

            {/* Stamina */}
            <div className="bg-black/70 rounded-lg p-2 backdrop-blur-sm border border-yellow-900/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-yellow-400 text-xs font-bold">STAMINA</span>
                <span className="text-yellow-300 text-xs">{Math.round(stats.stamina)}/{stats.maxStamina}</span>
              </div>
              <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-yellow-700 to-yellow-400 rounded-full transition-all" style={{ width: `${(stats.stamina / stats.maxStamina) * 100}%` }} />
              </div>
            </div>

            {/* Hunger */}
            <div className="bg-black/70 rounded-lg p-2 backdrop-blur-sm border border-green-900/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-green-400 text-xs font-bold">HUNGER</span>
                <span className="text-green-300 text-xs">{Math.round(stats.hunger)}/{stats.maxHunger}</span>
              </div>
              <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-green-700 to-green-400 rounded-full transition-all" style={{ width: `${(stats.hunger / stats.maxHunger) * 100}%` }} />
              </div>
            </div>

            {/* XP & Level */}
            <div className="bg-black/70 rounded-lg p-2 backdrop-blur-sm border border-amber-900/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-amber-400 text-xs font-bold">LEVEL {stats.level}</span>
                <span className="text-amber-300 text-xs">{stats.xp}/{stats.xpToNext} XP</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-700 to-amber-400 rounded-full transition-all" style={{ width: `${(stats.xp / stats.xpToNext) * 100}%` }} />
              </div>
            </div>

            {/* Territory */}
            <div className="bg-black/70 rounded-lg p-2 backdrop-blur-sm border border-purple-900/30">
              <span className="text-purple-400 text-xs font-bold">TERRITORY: </span>
              <span className="text-purple-300 text-xs">{stats.territory}/5</span>
            </div>
          </div>

          {/* Mission Panel */}
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
                  <div className="h-full bg-gradient-to-r from-amber-700 to-amber-400 rounded-full transition-all" style={{ width: `${(currentMission.currentCount / currentMission.targetCount) * 100}%` }} />
                </div>
                {currentMission.reward && (
                  <p className="text-green-400 text-[10px] mt-1">Reward: {currentMission.reward}</p>
                )}
              </div>
            </div>
          )}

          {/* Crosshair */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="w-6 h-6 border-2 border-amber-400/50 rounded-full" />
            <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-amber-400 rounded-full -translate-x-1/2 -translate-y-1/2" />
          </div>

          {/* Notification */}
          {notification && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
              <div className="bg-amber-900/80 text-amber-200 px-6 py-3 rounded-lg text-lg font-bold border border-amber-500/50 backdrop-blur-sm animate-pulse">
                {notification}
              </div>
            </div>
          )}

          {/* Controls Guide */}
          {showControls && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
              <div className="bg-black/85 rounded-xl p-6 backdrop-blur-md border border-amber-800/40 min-w-[320px]">
                <h3 className="text-amber-400 text-lg font-bold mb-4 text-center">CONTROLS</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-gray-400">W / Up</div><div className="text-gray-200">Move Forward</div>
                  <div className="text-gray-400">S / Down</div><div className="text-gray-200">Move Backward</div>
                  <div className="text-gray-400">A / Left</div><div className="text-gray-200">Turn Left</div>
                  <div className="text-gray-400">D / Right</div><div className="text-gray-200">Turn Right</div>
                  <div className="text-gray-400">Space</div><div className="text-gray-200">Fly Up</div>
                  <div className="text-gray-400">Shift</div><div className="text-gray-200">Fly Down</div>
                  <div className="text-gray-400">Left Click</div><div className="text-red-300 font-bold">Fire Breath</div>
                  <div className="text-gray-400">Right Click (Air)</div><div className="text-red-300 font-bold">Dive Attack</div>
                  <div className="text-gray-400">Tab</div><div className="text-gray-200">Toggle Controls</div>
                  <div className="text-gray-400">Esc</div><div className="text-gray-200">Pause</div>
                </div>
                <p className="text-amber-300/60 text-xs mt-4 text-center">Press Tab to close</p>
              </div>
            </div>
          )}

          {/* Flight indicator */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
            <div className="bg-black/60 rounded-full px-4 py-1 backdrop-blur-sm border border-gray-700/30">
              <span className="text-xs text-gray-300">
                {stats.stamina < 10 ? '⚠ EXHAUSTED' : 'Ready'}
              </span>
            </div>
          </div>
        </>
      )}

      {/* ---- PAUSE SCREEN ---- */}
      {gameState === 'paused' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <h2 className="text-4xl font-bold text-amber-500 mb-8">PAUSED</h2>
          <button
            onClick={() => setGameState('playing')}
            className="px-8 py-3 bg-red-800 hover:bg-red-700 text-amber-100 text-lg font-bold rounded-lg border-2 border-amber-600/50 transition-all hover:scale-105 mb-4"
          >
            RESUME
          </button>
          <button
            onClick={() => setGameState('menu')}
            className="px-8 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-lg rounded-lg border border-gray-600/50 transition-all hover:scale-105"
          >
            MAIN MENU
          </button>
        </div>
      )}

      {/* ---- GAME OVER SCREEN ---- */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-black via-red-950/80 to-black">
          <h2 className="text-5xl font-bold text-red-500 mb-4" style={{ textShadow: '0 0 30px rgba(220,38,38,0.5)' }}>
            FALLEN
          </h2>
          <p className="text-gray-400 text-lg mb-2">Your reign has ended.</p>
          <p className="text-amber-400 mb-8">Level Reached: {stats.level} | Territory: {stats.territory}/5</p>
          <button
            onClick={() => setGameState('menu')}
            className="px-10 py-3 bg-red-800 hover:bg-red-700 text-amber-100 text-lg font-bold rounded-lg border-2 border-amber-600/50 transition-all hover:scale-105"
          >
            TRY AGAIN
          </button>
        </div>
      )}

      {/* ---- VICTORY SCREEN ---- */}
      {gameState === 'victory' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-amber-950 via-gray-900 to-amber-950">
          <h2 className="text-5xl font-bold text-amber-400 mb-4" style={{ textShadow: '0 0 40px rgba(217,119,6,0.6)' }}>
            KINGDOM CONQUERED
          </h2>
          <p className="text-amber-200/80 text-lg mb-2">The Dragon King has fallen. You rule the skies.</p>
          <p className="text-amber-400 mb-8">Final Level: {stats.level} | Territory: {stats.territory}/5</p>
          <button
            onClick={() => setGameState('menu')}
            className="px-10 py-3 bg-amber-800 hover:bg-amber-700 text-amber-100 text-lg font-bold rounded-lg border-2 border-amber-500/50 transition-all hover:scale-105"
          >
            PLAY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}
