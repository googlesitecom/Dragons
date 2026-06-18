'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import {
  EffectComposer, RenderPass, BloomEffect, EffectPass,
  VignetteEffect, SMAAEffect, SMAAPreset,
} from 'postprocessing';

// ============================================================
// SOUND ENGINE
// ============================================================
class SoundEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicPlaying = false;

  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.3;
    this.gain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.08;
    this.musicGain.connect(this.ctx.destination);
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.3) {
    if (!this.ctx || !this.gain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(volume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(g); g.connect(this.gain); osc.start(); osc.stop(this.ctx.currentTime + duration);
  }

  private playNoise(duration: number, volume = 0.2) {
    if (!this.ctx || !this.gain) return;
    const bs = this.ctx.sampleRate * duration;
    const buf = this.ctx.createBuffer(1, bs, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = this.ctx.createBufferSource(); const g = this.ctx.createGain();
    src.buffer = buf; g.gain.setValueAtTime(volume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    src.connect(g); g.connect(this.gain); src.start();
  }

  // Background music - epic ambient loop using Web Audio
  startMusic() {
    if (this.musicPlaying || !this.ctx || !this.musicGain) return;
    this.musicPlaying = true;
    const playLoop = () => {
      if (!this.musicPlaying || !this.ctx || !this.musicGain) return;
      const now = this.ctx.currentTime;
      // Deep drone pad
      const notes = [55, 82.41, 110, 65.41, 73.42]; // A1, E2, A2, C2, D2
      notes.forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        const filter = this.ctx!.createBiquadFilter();
        osc.type = i < 2 ? 'sawtooth' : 'sine';
        osc.frequency.value = freq;
        // Slow LFO for movement
        const lfo = this.ctx!.createOscillator();
        const lfoGain = this.ctx!.createGain();
        lfo.frequency.value = 0.1 + i * 0.05;
        lfoGain.gain.value = freq * 0.02;
        lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
        lfo.start(now); lfo.stop(now + 16);
        filter.type = 'lowpass'; filter.frequency.value = 400 + i * 100; filter.Q.value = 1;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.15 - i * 0.02, now + 3);
        g.gain.linearRampToValueAtTime(0.12 - i * 0.02, now + 12);
        g.gain.linearRampToValueAtTime(0, now + 16);
        osc.connect(filter); filter.connect(g); g.connect(this.musicGain!);
        osc.start(now); osc.stop(now + 16);
      });
      // Ethereal high melody
      const melody = [440, 523.25, 659.25, 587.33, 523.25, 440, 392, 440];
      melody.forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = now + i * 2;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.06, t + 0.5);
        g.gain.linearRampToValueAtTime(0, t + 1.8);
        osc.connect(g); g.connect(this.musicGain!);
        osc.start(t); osc.stop(t + 2);
      });
      setTimeout(() => playLoop(), 15000);
    };
    playLoop();
  }

  stopMusic() { this.musicPlaying = false; }

  fireBreath() { this.playNoise(0.4, 0.25); this.playTone(120, 0.3, 'sawtooth', 0.15); }
  roar() { this.playTone(60, 0.8, 'sawtooth', 0.4); this.playTone(80, 0.6, 'square', 0.2); }
  hit() { this.playTone(200, 0.15, 'square', 0.2); this.playNoise(0.1, 0.15); }
  kill() { this.playTone(400, 0.1, 'square', 0.3); this.playTone(600, 0.15, 'sine', 0.2); this.playTone(800, 0.2, 'sine', 0.15); }
  dive() { this.playNoise(0.6, 0.3); this.playTone(100, 0.5, 'sawtooth', 0.1); }
  impact() { this.playNoise(0.5, 0.4); this.playTone(50, 0.4, 'sawtooth', 0.3); this.playTone(80, 0.3, 'square', 0.2); }
  shipExplosion() { this.playNoise(1.0, 0.5); this.playTone(40, 0.8, 'sawtooth', 0.4); this.playTone(60, 0.6, 'square', 0.3); this.playTone(200, 0.4, 'sine', 0.2); }
  levelUp() { [400, 500, 600, 800].forEach((f, i) => setTimeout(() => this.playTone(f, 0.3, 'sine', 0.3), i * 100)); }
  arrowHit() { this.playNoise(0.08, 0.1); this.playTone(300, 0.08, 'square', 0.1); }
  ambientOcean() { this.playNoise(2, 0.03); this.playTone(60, 2, 'sine', 0.02); }
  cinematicBoom() { this.playNoise(1.5, 0.6); this.playTone(30, 1.2, 'sawtooth', 0.5); this.playTone(50, 1.0, 'square', 0.3); }
}

const sound = new SoundEngine();

// ============================================================
// TYPES
// ============================================================
interface Stats { health: number; maxHealth: number; stamina: number; maxStamina: number; hunger: number; maxHunger: number; xp: number; level: number; xpToNext: number; territory: number; gold: number; breathFuel: number; maxBreathFuel: number; }
interface Mission { id: number; title: string; description: string; objective: string; targetCount: number; currentCount: number; completed: boolean; reward: string; markerPos: THREE.Vector3; }
interface Enemy { mesh: THREE.Group; type: 'ship' | 'dragon' | 'boss'; health: number; maxHealth: number; speed: number; attackCooldown: number; attackRange: number; damage: number; alive: boolean; position: THREE.Vector3; patrolAngle: number; fireTimer: number; aggroRange: number; stunned: number; hitFlash: number; }
interface Projectile { mesh: THREE.Mesh; velocity: THREE.Vector3; damage: number; lifetime: number; fromEnemy: boolean; type: string; }
interface Particle { mesh: THREE.Mesh; velocity: THREE.Vector3; lifetime: number; maxLifetime: number; }
interface DmgNum { mesh: THREE.Sprite; velocity: THREE.Vector3; lifetime: number; }

const WATER_Y = 0;

// ============================================================
// GAME COMPONENT
// ============================================================
export default function DragonGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id); }, []);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'paused' | 'gameover' | 'victory'>('menu');
  const [stats, setStats] = useState<Stats>({ health: 200, maxHealth: 200, stamina: 150, maxStamina: 150, hunger: 100, maxHunger: 100, xp: 0, level: 1, xpToNext: 80, territory: 0, gold: 0, breathFuel: 120, maxBreathFuel: 120 });
  const [currentMission, setCurrentMission] = useState<Mission | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [notification, setNotification] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  const G = useRef<{
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; composer: EffectComposer;
    dragon: THREE.Group; clock: THREE.Clock; keys: Set<string>; mouse: { dx: number; dy: number; down: boolean };
    stats: Stats; enemies: Enemy[]; projectiles: Projectile[]; particles: Particle[]; dmgNums: DmgNum[];
    missions: Mission[]; mi: number; markers: THREE.Group[];
    isGrounded: boolean; isFlying: boolean; isBreathingFire: boolean; isDiving: boolean; isSprinting: boolean;
    diveVel: THREE.Vector3; dragonVel: THREE.Vector3; animId: number; terrain: THREE.Mesh;
    yaw: number; pitch: number; wingAngle: number; wingDir: number;
    hungerT: number; staminaT: number; fireT: number; notifT: number; dragonScale: number; active: boolean;
    dayTime: number; sun: THREE.DirectionalLight; sunMesh: THREE.Mesh; ambient: THREE.AmbientLight; fog: THREE.Color;
    fireLight: THREE.PointLight; dragonModel: THREE.Group | null; mixer: THREE.AnimationMixer | null;
    camShake: number; killStreak: number; comboT: number; bloom: BloomEffect | null;
    water: THREE.Mesh; islands: THREE.Group[]; ambientT: number;
    slowMo: number; cinematicMode: boolean; cinematicTimer: number; cinematicTarget: THREE.Vector3 | null;
    baseScale: number;
  } | null>(null);

  const notify = useCallback((m: string) => { setNotification(m); if (G.current) G.current.notifT = 3; }, []);

  const makeMissions = useCallback((): Mission[] => [
    { id: 1, title: 'First Blood', description: 'Destroy the patrol ships in the eastern waters.', objective: 'Destroy patrol ships', targetCount: 3, currentCount: 0, completed: false, reward: '+60 XP, +40 Gold', markerPos: new THREE.Vector3(200, 0, 0) },
    { id: 2, title: 'Dragon Skirmish', description: 'Rival dragons patrol the northern skies. Challenge them.', objective: 'Defeat rival dragons', targetCount: 3, currentCount: 0, completed: false, reward: '+120 XP, +80 Gold', markerPos: new THREE.Vector3(0, 30, -250) },
    { id: 3, title: 'Armada', description: 'A war fleet approaches from the south. Burn their ships.', objective: 'Destroy the war fleet', targetCount: 5, currentCount: 0, completed: false, reward: '+100 XP, +100 Gold', markerPos: new THREE.Vector3(-100, 0, 200) },
    { id: 4, title: 'Dragon Council', description: 'The elder dragons gather at the central island. Prove your dominance.', objective: 'Defeat the elder dragons', targetCount: 4, currentCount: 0, completed: false, reward: '+200 XP, +150 Gold', markerPos: new THREE.Vector3(0, 40, 0) },
    { id: 5, title: 'The Sea Leviathan', description: 'An ancient dragon king rises from the deep. Only you can stop it.', objective: 'Defeat the Dragon King', targetCount: 1, currentCount: 0, completed: false, reward: 'VICTORY', markerPos: new THREE.Vector3(0, 50, -100) },
  ], []);

  // ============================================================
  // CREATE OCEAN WORLD
  // ============================================================
  const createOcean = useCallback((scene: THREE.Scene) => {
    // Sky gradient
    scene.background = new THREE.Color(0x1a2a4a);

    // Ocean
    const waterGeo = new THREE.PlaneGeometry(4000, 4000, 128, 128);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a4a7a, roughness: 0.05, metalness: 0.2,
      transparent: true, opacity: 0.85,
      transmission: 0.3, thickness: 2.0,
      envMapIntensity: 1.0,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    scene.add(water);

    // Floating islands
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3a5a2a, roughness: 0.8, metalness: 0.05 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.1 });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xc2b280, roughness: 0.85 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x2d5a1e, roughness: 0.75 });

    const islands: THREE.Group[] = [];
    const islandDefs = [
      { x: 0, z: 0, r: 40, h: 15 }, // Central - big
      { x: 200, z: 0, r: 25, h: 10 },
      { x: -150, z: 100, r: 30, h: 12 },
      { x: 100, z: -200, r: 20, h: 8 },
      { x: -200, z: -150, r: 22, h: 9 },
      { x: 300, z: 150, r: 18, h: 7 },
      { x: -100, z: 250, r: 28, h: 11 },
      { x: 50, z: -300, r: 15, h: 6 },
      { x: -250, z: -50, r: 20, h: 8 },
      { x: 350, z: -100, r: 22, h: 9 },
      { x: -300, z: -200, r: 16, h: 7 },
      { x: 150, z: 250, r: 25, h: 10 },
    ];

    islandDefs.forEach(def => {
      const island = new THREE.Group();
      // Base rock underwater
      const baseGeo = new THREE.ConeGeometry(def.r * 1.2, def.h * 2, 12);
      const base = new THREE.Mesh(baseGeo, rockMat);
      base.position.y = -def.h * 0.5;
      base.castShadow = true;
      island.add(base);
      // Top land
      const topGeo = new THREE.CylinderGeometry(def.r, def.r * 1.1, 4, 12);
      const top = new THREE.Mesh(topGeo, islandMat);
      top.position.y = def.h * 0.3;
      top.castShadow = true;
      top.receiveShadow = true;
      island.add(top);
      // Sand beach ring
      const beachGeo = new THREE.TorusGeometry(def.r * 0.9, 3, 8, 16);
      const beach = new THREE.Mesh(beachGeo, sandMat);
      beach.position.y = def.h * 0.1;
      beach.rotation.x = Math.PI / 2;
      island.add(beach);
      // Grass top
      const grassGeo = new THREE.CylinderGeometry(def.r * 0.7, def.r * 0.8, 1, 12);
      const grass = new THREE.Mesh(grassGeo, grassMat);
      grass.position.y = def.h * 0.5 + 2;
      grass.receiveShadow = true;
      island.add(grass);
      // Trees on larger islands
      if (def.r > 20) {
        for (let t = 0; t < 5; t++) {
          const tree = new THREE.Group();
          const ta = Math.random() * Math.PI * 2;
          const td = Math.random() * def.r * 0.5;
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 5, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 }));
          trunk.position.y = 2.5;
          trunk.castShadow = true;
          tree.add(trunk);
          const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 6), new THREE.MeshStandardMaterial({ color: 0x1a6a0a, roughness: 0.7 }));
          leaves.position.y = 6;
          leaves.castShadow = true;
          tree.add(leaves);
          tree.position.set(Math.cos(ta) * td, def.h * 0.5 + 2.5, Math.sin(ta) * td);
          island.add(tree);
        }
      }
      island.position.set(def.x, WATER_Y, def.z);
      scene.add(island);
      islands.push(island);
    });

    // Rocks sticking out of water
    for (let i = 0; i < 40; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1 + Math.random() * 3, 0),
        rockMat
      );
      rock.position.set(
        (Math.random() - 0.5) * 800,
        WATER_Y - 1 + Math.random() * 3,
        (Math.random() - 0.5) * 800
      );
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      scene.add(rock);
    }

    return { water, islands };
  }, []);

  // ============================================================
  // CREATE SHIP
  // ============================================================
  const createShip = useCallback((pos: THREE.Vector3): { mesh: THREE.Group; health: number; speed: number; attackCooldown: number; attackRange: number; damage: number; aggroRange: number } => {
    const ship = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6B3410, roughness: 0.8 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xddccaa, roughness: 0.6, side: THREE.DoubleSide });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x3a1a05, roughness: 0.9 });

    // Hull
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-4, 0); hullShape.lineTo(-3.5, -2); hullShape.lineTo(3.5, -2);
    hullShape.lineTo(4, 0); hullShape.lineTo(3, 1.5); hullShape.lineTo(-3, 1.5); hullShape.lineTo(-4, 0);
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 12, bevelEnabled: false });
    const hull = new THREE.Mesh(hullGeo, woodMat);
    hull.rotation.y = Math.PI / 2;
    hull.position.set(0, 1, -6);
    hull.castShadow = true;
    ship.add(hull);

    // Deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 12), darkWood);
    deck.position.y = 2.5;
    deck.castShadow = true;
    ship.add(deck);

    // Mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 12, 6), woodMat);
    mast.position.y = 8;
    mast.castShadow = true;
    ship.add(mast);

    // Sail
    const sailGeo = new THREE.PlaneGeometry(6, 8);
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(0, 9, 0);
    sail.castShadow = true;
    ship.add(sail);

    // Cross beam
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8, 4), woodMat);
    beam.position.set(0, 12, 0);
    beam.rotation.z = Math.PI / 2;
    ship.add(beam);

    // Flag
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.5), new THREE.MeshStandardMaterial({ color: 0xcc2222, side: THREE.DoubleSide }));
    flag.position.set(1.5, 12, 0);
    ship.add(flag);

    // Archers on deck (visual only)
    for (let i = -1; i <= 1; i++) {
      const archer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x444444 }));
      archer.position.set(i * 2, 3.5, -2);
      ship.add(archer);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshStandardMaterial({ color: 0xc4956a }));
      head.position.set(i * 2, 4.3, -2);
      ship.add(head);
    }

    // Torches
    for (const tx of [-3, 3]) {
      const torch = new THREE.PointLight(0xff8833, 3, 20);
      torch.position.set(tx, 4, 0);
      ship.add(torch);
    }

    ship.position.copy(pos);
    return { mesh: ship, health: 60, speed: 3, attackCooldown: 2.0, attackRange: 80, damage: 8, aggroRange: 100 };
  }, []);

  // ============================================================
  // CREATE DRAGON ENEMY
  // ============================================================
  const createEnemyDragon = useCallback((pos: THREE.Vector3, isBoss: boolean) => {
    const group = new THREE.Group();
    const bodyCol = isBoss ? 0x440066 : 0x8B0000;
    const wingCol = isBoss ? 0x220033 : 0x5a0000;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.4, metalness: 0.4 });
    const wingMat = new THREE.MeshStandardMaterial({ color: wingCol, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8).scale(1, 0.7, 1.8) as THREE.BufferGeometry, bodyMat);
    body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8).scale(0.8, 0.7, 1.2) as THREE.BufferGeometry, bodyMat);
    head.position.set(0, 0.8, -3.8); head.castShadow = true; group.add(head);
    [-0.5, 0.5].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), eyeMat); e.position.set(x, 1.3, -4); group.add(e); });

    const ws = new THREE.Shape(); ws.moveTo(0, 0); ws.lineTo(1, 0.5); ws.lineTo(4, 2.5); ws.lineTo(6, 2); ws.lineTo(5, 0.8); ws.lineTo(2.5, -0.3); ws.lineTo(0, 0);
    const wGeo = new THREE.ShapeGeometry(ws);
    const lw = new THREE.Mesh(wGeo, wingMat); lw.position.set(1.5, 0.5, -0.5); lw.rotation.y = Math.PI / 2; lw.name = 'leftWing'; group.add(lw);
    const rw = new THREE.Mesh(wGeo, wingMat); rw.position.set(-1.5, 0.5, -0.5); rw.rotation.y = -Math.PI / 2; rw.name = 'rightWing'; group.add(rw);
    // Tail
    for (let i = 0; i < 6; i++) { const t = i / 6, r = 0.7 * (1 - t * 0.8); const s = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), bodyMat); s.position.set(0, -0.2 + t * 0.3, 1.5 + i * 1.1); group.add(s); }
    const fl = new THREE.PointLight(isBoss ? 0x8800ff : 0xff0000, 0, 20); fl.position.set(0, 0.8, -5.5); group.add(fl);

    const s = isBoss ? 2.5 : 1;
    group.scale.set(s, s, s);
    group.position.copy(pos);
    return {
      mesh: group, type: isBoss ? 'boss' as const : 'dragon' as const,
      health: isBoss ? 250 : 80, speed: isBoss ? 10 : 8, attackCooldown: isBoss ? 2.5 : 3.0,
      attackRange: isBoss ? 65 : 50, damage: isBoss ? 15 : 10, aggroRange: isBoss ? 180 : 110,
    };
  }, []);

  // ============================================================
  // PROCEDURAL PLAYER DRAGON (fallback)
  // ============================================================
  const createPlayerDragon = useCallback((scene: THREE.Scene) => {
    const d = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ color: 0x2d1b0e, roughness: 0.5, metalness: 0.4 });
    const wm = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
    const em = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 3 });
    const hm = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.3, metalness: 0.5 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8).scale(1, 0.7, 1.8) as THREE.BufferGeometry, bm);
    body.castShadow = true; d.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 3.5, 8), bm);
    neck.position.set(0, 0.8, -3.5); neck.rotation.x = -0.4; neck.castShadow = true; d.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8).scale(0.8, 0.7, 1.2) as THREE.BufferGeometry, bm);
    head.position.set(0, 1.8, -5.5); head.castShadow = true; d.add(head);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2, 8), bm);
    snout.position.set(0, 1.5, -7); snout.rotation.x = Math.PI / 2; d.add(snout);
    [-0.6, 0.6].forEach(x => { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), em); eye.position.set(x, 2.2, -5.8); d.add(eye); });
    [[-0.5, 0.3], [0.5, -0.3]].forEach(([x, rz]) => { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 2, 6), hm); horn.position.set(x as number, 3.0, -5); horn.rotation.x = -0.3; horn.rotation.z = rz as number; d.add(horn); });
    const wShape = new THREE.Shape(); wShape.moveTo(0, 0); wShape.lineTo(1.5, 0.8); wShape.lineTo(5, 3.5); wShape.lineTo(7, 3); wShape.lineTo(6, 1.2); wShape.lineTo(3.5, -0.3); wShape.lineTo(0, 0);
    const wGeo = new THREE.ShapeGeometry(wShape);
    const lw = new THREE.Mesh(wGeo, wm); lw.position.set(1.5, 0.5, -1); lw.rotation.y = Math.PI / 2; lw.rotation.z = 0.3; lw.name = 'leftWing'; d.add(lw);
    const rw = new THREE.Mesh(wGeo, wm); rw.position.set(-1.5, 0.5, -1); rw.rotation.y = -Math.PI / 2; rw.rotation.z = -0.3; rw.name = 'rightWing'; d.add(rw);
    for (let i = 0; i < 10; i++) { const t = i / 10, r = 0.8 * (1 - t * 0.85); const s = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), bm); s.position.set(0, -0.3 + t * 0.5, 2 + i * 1.1); s.castShadow = true; d.add(s); }
    const ts = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.5, 6), hm); ts.position.set(0, 2.5, 2 + 10 * 1.1); ts.rotation.x = Math.PI / 2; d.add(ts);
    for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 4), hm); sp.position.set(0, 1.8 - i * 0.04, -2.5 + i * 0.7); d.add(sp); }
    const legG = new THREE.CylinderGeometry(0.35, 0.5, 2.5, 6);
    [{ x: 1.3, z: -0.5 }, { x: -1.3, z: -0.5 }, { x: 1.3, z: 1.5 }, { x: -1.3, z: 1.5 }].forEach(lp => { const l = new THREE.Mesh(legG, bm); l.position.set(lp.x, -1.5, lp.z); l.castShadow = true; d.add(l); });
    const fl = new THREE.PointLight(0xff4400, 0, 35); fl.position.set(0, 1.5, -7.5); d.add(fl);

    d.position.set(0, 20, 0);
    d.scale.set(2.3, 2.3, 2.3); // Bigger dragon
    d.castShadow = true;
    scene.add(d);
    return d;
  }, []);

  // ============================================================
  // MISSION MARKERS
  // ============================================================
  const createMarkers = useCallback((scene: THREE.Scene, missions: Mission[]): THREE.Group[] => {
    const markers: THREE.Group[] = [];
    const mMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 3, roughness: 0.1, metalness: 0.9 });
    missions.forEach((m) => {
      const mk = new THREE.Group();
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 50, 8), mMat); pillar.position.y = 25; mk.add(pillar);
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), mMat); diamond.position.y = 53; diamond.name = 'md'; mk.add(diamond);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.3, 8, 24), mMat); ring.position.y = 53; ring.rotation.x = Math.PI / 2; ring.name = 'mr'; mk.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 2, 80, 8), new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.12 })); beam.position.y = 90; mk.add(beam);
      const light = new THREE.PointLight(0xffaa00, 10, 120); light.position.y = 53; mk.add(light);
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#00000088'; ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 64px sans-serif'; ctx.fillStyle = '#ffaa00'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${m.id}`, 64, 64);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
      sp.position.y = 65; sp.scale.set(12, 12, 1); mk.add(sp);
      mk.position.set(m.markerPos.x, WATER_Y, m.markerPos.z);
      mk.visible = m.id === 1;
      scene.add(mk); markers.push(mk);
    });
    return markers;
  }, []);

  // ============================================================
  // SPAWN ENEMIES - BALANCED
  // ============================================================
  const spawnEnemies = useCallback((scene: THREE.Scene) => {
    const enemies: Enemy[] = [];
    // Mission 1: Patrol ships (easy)
    for (let i = 0; i < 3; i++) {
      const data = createShip(new THREE.Vector3(180 + i * 40, WATER_Y + 2, -20 + i * 20));
      scene.add(data.mesh);
      enemies.push({ ...data, type: 'ship', maxHealth: data.health, alive: true, position: data.mesh.position.clone(), patrolAngle: i * 2, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }
    // Mission 2: Rival dragons (medium)
    for (let i = 0; i < 3; i++) {
      const data = createEnemyDragon(new THREE.Vector3(-50 + i * 50, 30 + i * 5, -250), false);
      scene.add(data.mesh);
      enemies.push({ ...data, maxHealth: data.health, alive: true, position: data.mesh.position.clone(), patrolAngle: i * 2, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }
    // Mission 3: War fleet (medium)
    for (let i = 0; i < 5; i++) {
      const data = createShip(new THREE.Vector3(-120 + i * 30, WATER_Y + 2, 180 + i * 15));
      scene.add(data.mesh);
      enemies.push({ ...data, type: 'ship', maxHealth: data.health, alive: true, position: data.mesh.position.clone(), patrolAngle: i, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }
    // Mission 4: Elder dragons (hard)
    for (let i = 0; i < 4; i++) {
      const data = createEnemyDragon(new THREE.Vector3(-30 + i * 20, 35 + i * 3, -10 + i * 10), false);
      scene.add(data.mesh);
      enemies.push({ ...data, maxHealth: data.health, alive: true, position: data.mesh.position.clone(), patrolAngle: i * 1.5, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: data.aggroRange });
    }
    // Mission 5: Dragon King Boss
    const bossData = createEnemyDragon(new THREE.Vector3(0, 50, -100), true);
    scene.add(bossData.mesh);
    enemies.push({ ...bossData, maxHealth: bossData.health, alive: true, position: bossData.mesh.position.clone(), patrolAngle: 0, fireTimer: 0, stunned: 0, hitFlash: 0, aggroRange: bossData.aggroRange });

    return enemies;
  }, [createShip, createEnemyDragon]);

  // ============================================================
  // FIRE BREATH WITH AUTO-AIM
  // ============================================================
  const breatheFire = useCallback(() => {
    const g = G.current; if (!g || g.stats.stamina < 1 || g.stats.breathFuel < 1) return;
    g.stats.stamina -= 1; g.stats.breathFuel -= 0.5;
    g.isBreathingFire = true; g.fireLight.intensity = 15;
    sound.fireBreath();

    let closest: Enemy | null = null, closestD = Infinity;
    g.enemies.forEach(e => { if (!e.alive) return; const d = e.mesh.position.distanceTo(g.dragon.position); if (d < closestD && d < 180) { closestD = d; closest = e; } });

    const dir = closest
      ? new THREE.Vector3().subVectors(closest.mesh.position, g.dragon.position).normalize()
      : new THREE.Vector3(-Math.sin(g.yaw), 0, -Math.cos(g.yaw));
    const pos = g.dragon.position.clone().add(dir.clone().multiplyScalar(7)); pos.y += 2;

    for (let i = 0; i < 14; i++) {
      const sz = 0.5 + Math.random() * 1;
      const m = new THREE.Mesh(new THREE.SphereGeometry(sz, 6, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(i < 5 ? Math.random() * 0.04 : 0.04 + Math.random() * 0.08, 1, i < 5 ? 0.6 + Math.random() * 0.3 : 0.4 + Math.random() * 0.3), transparent: true, opacity: 0.95 }));
      m.position.copy(pos);
      const spread = closest ? 0.12 : 0.25;
      const spd = 55 + Math.random() * 35;
      const vel = dir.clone().multiplyScalar(spd);
      vel.x += (Math.random() - 0.5) * spread * spd; vel.y += (Math.random() - 0.5) * spread * spd * 0.5; vel.z += (Math.random() - 0.5) * spread * spd;
      g.scene.add(m); g.particles.push({ mesh: m, velocity: vel, lifetime: 0.4 + Math.random() * 0.35, maxLifetime: 0.75 });
    }
    // Smoke
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.8 + Math.random() * 0.5, 4, 4), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.35 }));
      m.position.copy(pos);
      const vel = dir.clone().multiplyScalar(12 + Math.random() * 8); vel.y += 3 + Math.random() * 3;
      g.scene.add(m); g.particles.push({ mesh: m, velocity: vel, lifetime: 0.7 + Math.random() * 0.3, maxLifetime: 1.0 });
    }
    g.camShake = Math.max(g.camShake, 0.12);
  }, []);

  const enemyFire = useCallback((e: Enemy) => {
    const g = G.current; if (!g) return;
    const dir = new THREE.Vector3().subVectors(g.dragon.position, e.mesh.position).normalize();
    const pos = e.mesh.position.clone().add(dir.clone().multiplyScalar(3)); pos.y += 1;
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 5, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.02 + Math.random() * 0.04, 1, 0.5 + Math.random() * 0.3), transparent: true, opacity: 0.9 }));
      m.position.copy(pos);
      const vel = dir.clone().multiplyScalar(25 + Math.random() * 15);
      vel.x += (Math.random() - 0.5) * 10; vel.y += (Math.random() - 0.5) * 8; vel.z += (Math.random() - 0.5) * 10;
      g.scene.add(m); g.particles.push({ mesh: m, velocity: vel, lifetime: 0.6 + Math.random() * 0.3, maxLifetime: 0.9 });
    }
  }, []);

  const shootArrows = useCallback((e: Enemy) => {
    const g = G.current; if (!g) return;
    const dir = new THREE.Vector3().subVectors(g.dragon.position, e.mesh.position).normalize();
    // Shoot 3 arrows in a volley
    for (let i = -1; i <= 1; i++) {
      const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
      arrow.position.copy(e.mesh.position); arrow.position.y += 4;
      arrow.lookAt(g.dragon.position); arrow.rotateX(Math.PI / 2);
      const vel = dir.clone().multiplyScalar(50);
      vel.x += i * 3; vel.z += i * 3;
      g.scene.add(arrow);
      g.projectiles.push({ mesh: arrow, velocity: vel, damage: e.damage, lifetime: 3, fromEnemy: true, type: 'arrow' });
    }
  }, []);

  const createDmgNum = useCallback((pos: THREE.Vector3, dmg: number) => {
    const g = G.current; if (!g) return;
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 48px sans-serif'; ctx.fillStyle = '#ff4444'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.textAlign = 'center';
    ctx.strokeText(`${Math.round(dmg)}`, 64, 48); ctx.fillText(`${Math.round(dmg)}`, 64, 48);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sp.position.copy(pos); sp.position.y += 4; sp.scale.set(5, 2.5, 1);
    g.scene.add(sp); g.dmgNums.push({ mesh: sp, velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2), lifetime: 1.2 });
  }, []);

  // ============================================================
  // GAME LOOP
  // ============================================================
  const loopRef = useRef<() => void>(() => {});

  const loop = useCallback(() => {
    const g = G.current; if (!g || !g.active) return;
    let dt = Math.min(g.clock.getDelta(), 0.05);

    // Slow-mo for cinematic
    if (g.slowMo > 0) { g.slowMo -= dt; dt *= 0.2; } // 5x slower
    if (g.cinematicMode) {
      g.cinematicTimer -= g.clock.elapsedTime > 0 ? 0.016 : 0;
      if (g.cinematicTimer <= 0) { g.cinematicMode = false; g.slowMo = 0; }
    }
    const dragon = g.dragon; const keys = g.keys;

    // Day/night
    g.dayTime += dt * 0.015;
    const sa = g.dayTime;
    g.sun.position.set(Math.cos(sa) * 400, Math.sin(sa) * 300 + 50, 100);
    const si = Math.max(0.15, Math.sin(sa) * 0.5 + 0.5);
    g.sun.intensity = si * 1.5; g.ambient.intensity = 0.15 + si * 0.35;
    if (g.sunMesh) g.sunMesh.position.set(Math.cos(sa) * 600, Math.sin(sa) * 450 + 100, 150);
    const fogD = 0.0008 + (1 - si) * 0.0015;
    g.scene.fog = new THREE.FogExp2(g.fog, fogD);
    const sr = 0.08 + si * 0.2, sg = 0.12 + si * 0.2, sb = 0.25 + si * 0.35;
    g.fog.setRGB(sr, sg, sb); (g.scene.background as THREE.Color).copy(g.fog);
    if (g.bloom) g.bloom.intensity = 0.5 + si * 0.8;

    // Water wave animation
    const wPos = g.water.geometry.attributes.position;
    if (wPos) {
      for (let i = 0; i < wPos.count; i++) {
        const x = wPos.getX(i), z = wPos.getZ(i);
        wPos.setY(i, Math.sin(x * 0.02 + g.dayTime * 2) * 0.8 + Math.cos(z * 0.03 + g.dayTime * 1.5) * 0.5);
      }
      wPos.needsUpdate = true;
    }

    // Mouse look
    g.yaw -= g.mouse.dx * 0.003; g.pitch -= g.mouse.dy * 0.003;
    g.pitch = Math.max(-1.2, Math.min(1.0, g.pitch));
    g.mouse.dx = 0; g.mouse.dy = 0;

    // Movement
    const ms = 28 * dt, fs = 45 * dt;
    const spMul = (keys.has('e') && g.stats.stamina > 0) ? 1.8 : 1;
    const fwd = new THREE.Vector3(-Math.sin(g.yaw), 0, -Math.cos(g.yaw)).normalize();
    const right = new THREE.Vector3(Math.cos(g.yaw), 0, -Math.sin(g.yaw)).normalize();

    if (keys.has('w') || keys.has('arrowup')) { const s = g.isFlying ? fs * spMul : ms * spMul; dragon.position.add(fwd.clone().multiplyScalar(s)); if (g.isSprinting) g.stats.stamina -= dt * 5; }
    if (keys.has('s') || keys.has('arrowdown')) { const s = g.isFlying ? fs * 0.4 : ms * 0.5; dragon.position.add(fwd.clone().multiplyScalar(-s)); }
    if (keys.has('a') || keys.has('arrowleft')) { const s = g.isFlying ? fs * 0.6 : ms * 0.7; dragon.position.add(right.clone().multiplyScalar(-s)); }
    if (keys.has('d') || keys.has('arrowright')) { const s = g.isFlying ? fs * 0.6 : ms * 0.7; dragon.position.add(right.clone().multiplyScalar(s)); }

    g.isSprinting = keys.has('e') && g.stats.stamina > 0;
    if (keys.has(' ') && g.stats.stamina > 0) { g.isFlying = true; dragon.position.y += fs * 2 * spMul; g.stats.stamina -= dt * 5; g.isGrounded = false; }
    if (keys.has('shift')) { if (g.isFlying) dragon.position.y -= fs * 2.5; }

    // Dive (M key)
    if (keys.has('m') && g.isFlying && !g.isDiving) {
      g.isDiving = true; g.diveVel = fwd.clone().multiplyScalar(55); g.diveVel.y = -35;
      g.camShake = 0.3; sound.dive();
      for (let i = 0; i < 20; i++) {
        const pm = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random() * 0.3, 4, 4),
          new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.08, 1, 0.5 + Math.random() * 0.3), transparent: true, opacity: 0.8 }));
        pm.position.copy(dragon.position);
        const vel = new THREE.Vector3((Math.random() - 0.5) * 20, Math.random() * 10 + 5, (Math.random() - 0.5) * 20);
        g.scene.add(pm); g.particles.push({ mesh: pm, velocity: vel, lifetime: 0.4 + Math.random() * 0.3, maxLifetime: 0.7 });
      }
      keys.delete('m');
    }
    if (g.isDiving && g.isFlying) { g.diveVel.add(fwd.clone().multiplyScalar(dt * 100)); g.diveVel.y -= dt * 50; dragon.position.add(g.diveVel.clone().multiplyScalar(dt)); }

    // Gravity / ground
    const waterRest = WATER_Y + 3;
    if (!g.isFlying && !g.isDiving) {
      if (dragon.position.y > waterRest + 0.5) { g.dragonVel.y -= 25 * dt; dragon.position.add(g.dragonVel.clone().multiplyScalar(dt)); }
      if (dragon.position.y <= waterRest) { dragon.position.y = waterRest; g.dragonVel.set(0, 0, 0); g.isGrounded = true; g.isFlying = false; }
    }
    if (g.isFlying && dragon.position.y <= waterRest) {
      dragon.position.y = waterRest; g.isFlying = false; g.isGrounded = true; g.isDiving = false;
      g.diveVel.set(0, 0, 0); g.dragonVel.set(0, 0, 0); g.camShake = 0.5;
    }

    // Dragon orientation
    dragon.rotation.set(0, 0, 0); dragon.rotateY(g.yaw);
    const vp = g.isFlying ? g.pitch * 0.4 : 0; dragon.rotateX(vp);
    const bank = (keys.has('a') || keys.has('arrowleft')) ? 0.2 : (keys.has('d') || keys.has('arrowright')) ? -0.2 : 0;
    dragon.rotateZ(bank);

    // Wings
    if (g.isFlying || keys.has(' ')) { g.wingAngle += g.wingDir * dt * 10; if (g.wingAngle > 0.9 || g.wingAngle < -0.2) g.wingDir *= -1; }
    else g.wingAngle = 0.3;
    dragon.traverse(c => { if (c.name === 'leftWing') c.rotation.z = g.wingAngle; if (c.name === 'rightWing') c.rotation.z = -g.wingAngle; });
    if (g.mixer) g.mixer.update(dt);

    // Survival
    g.staminaT += dt;
    if (g.staminaT > 0.4) { g.staminaT = 0; g.stats.stamina = Math.min(g.stats.maxStamina, g.stats.stamina + (g.isGrounded ? 5 : 1)); g.stats.breathFuel = Math.min(g.stats.maxBreathFuel, g.stats.breathFuel + (g.isGrounded ? 3 : 0.5)); }
    g.hungerT += dt;
    if (g.hungerT > 5) { g.hungerT = 0; g.stats.hunger = Math.max(0, g.stats.hunger - 2); if (g.stats.hunger <= 0) g.stats.health -= 3; }

    // Fire
    if (g.isBreathingFire) { g.fireT += dt; if (g.fireT > 0.07) { g.fireT = 0; breatheFire(); } }
    if (!g.mouse.down) { g.isBreathingFire = false; g.fireLight.intensity *= 0.85; }

    // Roar
    if (keys.has('r') && g.stats.stamina > 15) { g.stats.stamina -= 15; g.camShake = 0.8; sound.roar(); g.enemies.forEach(e => { if (e.alive && e.mesh.position.distanceTo(dragon.position) < 35) e.stunned = 3; }); keys.delete('r'); }

    // Camera
    if (g.cinematicMode && g.cinematicTarget) {
      const cTime = 3.0 - (g.cinematicTimer > 0 ? g.cinematicTimer : 0);
      const cRadius = 25 - cTime * 3;
      const cAngle = cTime * 1.5;
      const cinematicPos = new THREE.Vector3(
        g.cinematicTarget.x + Math.cos(cAngle) * cRadius,
        g.cinematicTarget.y + 15 - cTime * 3,
        g.cinematicTarget.z + Math.sin(cAngle) * cRadius
      );
      g.camera.position.lerp(cinematicPos, 4 * dt);
      g.camera.lookAt(g.cinematicTarget.x, g.cinematicTarget.y + 5, g.cinematicTarget.z);
    } else {
      const cd = 14, ch = 6;
      const idealOff = new THREE.Vector3(dragon.position.x + Math.sin(g.yaw) * Math.cos(g.pitch * 0.3) * cd, dragon.position.y + ch + Math.sin(g.pitch * 0.3) * cd * 0.5, dragon.position.z + Math.cos(g.yaw) * Math.cos(g.pitch * 0.3) * cd);
      const idealLook = new THREE.Vector3(dragon.position.x - Math.sin(g.yaw) * 10, dragon.position.y + 2, dragon.position.z - Math.cos(g.yaw) * 10);
      g.camera.position.lerp(idealOff, 8 * dt); g.camera.lookAt(idealLook);
    }
    if (g.camShake > 0) { g.camera.position.x += (Math.random() - 0.5) * g.camShake; g.camera.position.y += (Math.random() - 0.5) * g.camShake; g.camShake *= 0.9; if (g.camShake < 0.01) g.camShake = 0; }

    // Enemies
    g.comboT -= dt; if (g.comboT <= 0) g.killStreak = 0;
    g.enemies.forEach(e => {
      if (!e.alive) return;
      e.fireTimer += dt;
      if (e.stunned > 0) { e.stunned -= dt; return; }
      if (e.hitFlash > 0) e.hitFlash -= dt;
      const dp = e.mesh.position.distanceTo(dragon.position);

      if (e.type === 'ship') {
        e.patrolAngle += dt * 0.3;
        if (dp < e.aggroRange) {
          // Ships slowly turn toward player and shoot
          const toP = new THREE.Vector3().subVectors(dragon.position, e.mesh.position);
          const targetAngle = Math.atan2(toP.x, toP.z);
          e.mesh.rotation.y += (targetAngle - e.mesh.rotation.y) * dt * 0.5;
          // Slowly move toward player
          e.mesh.position.add(toP.normalize().multiplyScalar(e.speed * dt * 0.3));
          if (dp < e.attackRange && e.fireTimer > e.attackCooldown) { e.fireTimer = 0; shootArrows(e); }
        } else {
          e.mesh.position.x += Math.cos(e.patrolAngle) * e.speed * dt;
          e.mesh.position.z += Math.sin(e.patrolAngle) * e.speed * dt;
          e.mesh.rotation.y = e.patrolAngle;
        }
        // Bob on water
        e.mesh.position.y = WATER_Y + 2 + Math.sin(g.dayTime * 2 + e.patrolAngle) * 0.5;
      } else {
        // Dragon AI
        e.patrolAngle += dt * 0.4;
        if (dp < e.aggroRange) {
          const toP = new THREE.Vector3().subVectors(dragon.position, e.mesh.position).normalize();
          e.mesh.position.add(toP.multiplyScalar(e.speed * dt));
          e.mesh.lookAt(dragon.position);
          if (dp < e.attackRange && e.fireTimer > e.attackCooldown) { e.fireTimer = 0; enemyFire(e); }
        } else {
          const pR = 50;
          const cx = e.type === 'boss' ? 0 : e.mesh.position.x, cz = e.type === 'boss' ? -100 : e.mesh.position.z;
          e.mesh.position.x = cx + Math.cos(e.patrolAngle) * pR * dt * 10;
          e.mesh.position.z = cz + Math.sin(e.patrolAngle) * pR * dt * 10;
          e.mesh.position.y = 35 + Math.sin(e.patrolAngle * 2) * 10;
          e.mesh.rotation.y = e.patrolAngle + Math.PI / 2;
        }
        const ew = Math.sin(e.patrolAngle * 5) * 0.6;
        e.mesh.traverse(c => { if (c.name === 'leftWing') c.rotation.z = ew; if (c.name === 'rightWing') c.rotation.z = -ew; });
      }
    });

    // Projectiles
    g.projectiles = g.projectiles.filter(p => {
      p.lifetime -= dt; if (p.lifetime <= 0) { g.scene.remove(p.mesh); return false; }
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      if (p.type === 'rock') p.velocity.y -= 15 * dt;
      if (p.fromEnemy) {
        const d = p.mesh.position.distanceTo(dragon.position);
        if (d < 4 * g.dragonScale) {
          g.stats.health -= p.damage; g.camShake = p.type === 'rock' ? 0.6 : 0.15;
          createDmgNum(dragon.position.clone(), p.damage); sound.arrowHit();
          g.scene.remove(p.mesh); return false;
        }
      }
      return true;
    });

    // Particles & hit detection
    g.particles = g.particles.filter(p => {
      p.lifetime -= dt; if (p.lifetime <= 0) { g.scene.remove(p.mesh); return false; }
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt)); p.velocity.y += 5 * dt;
      const lr = p.lifetime / p.maxLifetime;
      if (p.mesh.material instanceof THREE.MeshBasicMaterial) p.mesh.material.opacity = lr;
      p.mesh.scale.setScalar(lr * 1.5);

      for (const e of g.enemies) {
        if (!e.alive) continue;
        const d = p.mesh.position.distanceTo(e.mesh.position);
        const hr = e.type === 'boss' ? 8 : 5;
        if (d < hr) {
          const dmg = 22 + g.stats.level * 3;
          e.health -= dmg; e.hitFlash = 0.15;
          createDmgNum(e.mesh.position.clone(), dmg); sound.hit();
          g.killStreak++; g.comboT = 3;
          if (e.health <= 0) {
            e.alive = false; g.scene.remove(e.mesh); sound.kill();
            const xpG = e.type === 'boss' ? 300 : e.type === 'dragon' ? 60 : 30;
            const goldG = e.type === 'boss' ? 400 : e.type === 'dragon' ? 80 : 25;
            g.stats.xp += xpG; g.stats.gold += goldG;
            g.stats.hunger = Math.min(g.stats.maxHunger, g.stats.hunger + 8);
            if (g.killStreak > 1) notify(`${g.killStreak}x Streak! +${goldG}G`);

            if (g.stats.xp >= g.stats.xpToNext) {
              g.stats.level++; g.stats.xp -= g.stats.xpToNext; g.stats.xpToNext = Math.floor(g.stats.xpToNext * 1.5);
              g.stats.maxHealth += 15; g.stats.health = g.stats.maxHealth;
              g.stats.maxStamina += 10; g.stats.stamina = g.stats.maxStamina;
              g.stats.maxBreathFuel += 8; g.stats.breathFuel = g.stats.maxBreathFuel;
              // Dragon grows but does NOT shrink - only gets bigger
              const newScale = g.baseScale * (1 + g.stats.level * 0.08);
              if (newScale > g.dragonScale) {
                g.dragonScale = newScale;
                dragon.scale.setScalar(g.dragonScale);
              }
              g.camShake = 0.6; sound.levelUp(); notify(`LEVEL UP! Level ${g.stats.level}! Dragon grows stronger!`);
            }

            // Mission progress
            const mi = g.mi;
            if (mi < g.missions.length && !g.missions[mi].completed) {
              const m = g.missions[mi];
              let match = false;
              if (mi === 0 && e.type === 'ship' && e.mesh.position.x > 100) match = true;
              if (mi === 1 && e.type === 'dragon' && e.mesh.position.z < -100) match = true;
              if (mi === 2 && e.type === 'ship' && e.mesh.position.z > 100) match = true;
              if (mi === 3 && e.type === 'dragon' && Math.abs(e.mesh.position.x) < 100 && Math.abs(e.mesh.position.z) < 100) match = true;
              if (mi === 4 && e.type === 'boss') match = true;
              if (match) {
                m.currentCount++;
                if (m.currentCount >= m.targetCount) {
                  m.completed = true; notify(`Mission Complete: ${m.title}!`);
                  g.markers.forEach((mk, idx) => mk.visible = idx === mi + 1);
                  if (mi < g.missions.length - 1) g.mi = mi + 1;
                }
              }
            }
          }
          g.scene.remove(p.mesh); return false;
        }
      }
      return true;
    });

    // Damage numbers
    g.dmgNums = g.dmgNums.filter(dn => { dn.lifetime -= dt; if (dn.lifetime <= 0) { g.scene.remove(dn.mesh); return false; } dn.mesh.position.add(dn.velocity.clone().multiplyScalar(dt)); dn.velocity.y -= 3 * dt; (dn.mesh.material as THREE.SpriteMaterial).opacity = dn.lifetime / 1.2; return true; });

    // Dive landing
    if (g.isDiving && g.isGrounded) {
      g.isDiving = false; g.diveVel.set(0, 0, 0); g.camShake = 2.0; sound.impact();

      // Check for ship collision - CINEMATIC EXPLOSION
      let hitShip: Enemy | null = null;
      g.enemies.forEach(e => {
        if (!e.alive || e.type !== 'ship') return;
        if (e.mesh.position.distanceTo(dragon.position) < 20) hitShip = e;
      });

      if (hitShip) {
        // CINEMATIC MODE: slow-mo, camera zoom, massive explosion
        g.slowMo = 3.0; // 3 seconds of slow motion
        g.cinematicMode = true;
        g.cinematicTimer = 3.0;
        g.cinematicTarget = hitShip.mesh.position.clone();
        sound.cinematicBoom();
        sound.shipExplosion();

        // Massive explosion at ship position
        const shipPos = hitShip.mesh.position.clone();
        // Fire explosion
        for (let i = 0; i < 80; i++) {
          const sz = 1 + Math.random() * 2.5;
          const pm = new THREE.Mesh(new THREE.SphereGeometry(sz, 6, 6),
            new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random() * 0.12, 1, 0.4 + Math.random() * 0.5), transparent: true, opacity: 1.0 }));
          pm.position.copy(shipPos); pm.position.y += 2;
          const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 35;
          g.scene.add(pm); g.particles.push({ mesh: pm, velocity: new THREE.Vector3(Math.cos(a) * s, 15 + Math.random() * 30, Math.sin(a) * s), lifetime: 1.0 + Math.random() * 1.0, maxLifetime: 2.0 });
        }
        // Ship debris - planks flying
        for (let i = 0; i < 30; i++) {
          const plank = new THREE.Mesh(
            new THREE.BoxGeometry(0.3 + Math.random() * 2, 0.1 + Math.random() * 0.3, 0.5 + Math.random() * 3),
            new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2 + Math.random() * 0.3, 0.1 + Math.random() * 0.15, 0.02), roughness: 0.9 })
          );
          plank.position.copy(shipPos); plank.position.y += 3;
          plank.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
          const a = Math.random() * Math.PI * 2, s = 8 + Math.random() * 20;
          const vel = new THREE.Vector3(Math.cos(a) * s, 20 + Math.random() * 25, Math.sin(a) * s);
          g.scene.add(plank); g.particles.push({ mesh: plank, velocity: vel, lifetime: 2 + Math.random() * 1, maxLifetime: 3.0 });
        }
        // Smoke column
        for (let i = 0; i < 20; i++) {
          const sm = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 3, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5 }));
          sm.position.copy(shipPos); sm.position.y += 5 + Math.random() * 5;
          g.scene.add(sm); g.particles.push({ mesh: sm, velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 8 + Math.random() * 10, (Math.random() - 0.5) * 3), lifetime: 2 + Math.random() * 1, maxLifetime: 3.0 });
        }
        // Water geyser
        for (let i = 0; i < 25; i++) {
          const wm = new THREE.Mesh(new THREE.SphereGeometry(1.5 + Math.random() * 2, 4, 4), new THREE.MeshBasicMaterial({ color: 0x4488cc, transparent: true, opacity: 0.7 }));
          wm.position.copy(shipPos); wm.position.y = WATER_Y;
          const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 15;
          g.scene.add(wm); g.particles.push({ mesh: wm, velocity: new THREE.Vector3(Math.cos(a) * s, 25 + Math.random() * 20, Math.sin(a) * s), lifetime: 1 + Math.random() * 0.5, maxLifetime: 1.5 });
        }
        // Explosion light flash
        const expLight = new THREE.PointLight(0xff6600, 20, 80);
        expLight.position.copy(shipPos); expLight.position.y += 5;
        g.scene.add(expLight);
        // Fade out explosion light
        const fadeLight = () => { expLight.intensity *= 0.92; if (expLight.intensity > 0.1) requestAnimationFrame(fadeLight); else g.scene.remove(expLight); };
        requestAnimationFrame(fadeLight);

        // Destroy the ship
        hitShip.health = 0; hitShip.alive = false; g.scene.remove(hitShip.mesh);
        g.stats.xp += 50; g.stats.gold += 40;
        createDmgNum(shipPos, 999);
        notify('💥 SHIP DESTROYED!');
      }

      // Normal dive impact (water/ground)
      for (let i = 0; i < 35; i++) {
        const pm = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 1, 4, 4),
          new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.06 + Math.random() * 0.06, 1, 0.5 + Math.random() * 0.4), transparent: true, opacity: 0.9 }));
        pm.position.copy(dragon.position); pm.position.y += 1;
        const a = Math.random() * Math.PI * 2, s = 15 + Math.random() * 25;
        g.scene.add(pm); g.particles.push({ mesh: pm, velocity: new THREE.Vector3(Math.cos(a) * s, 10 + Math.random() * 20, Math.sin(a) * s), lifetime: 0.5 + Math.random() * 0.4, maxLifetime: 0.9 });
      }
      // Water splash
      for (let i = 0; i < 20; i++) {
        const wm = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random(), 4, 4), new THREE.MeshBasicMaterial({ color: 0x4488cc, transparent: true, opacity: 0.6 }));
        wm.position.copy(dragon.position); wm.position.y = WATER_Y + 1;
        const a = Math.random() * Math.PI * 2, s = 8 + Math.random() * 12;
        g.scene.add(wm); g.particles.push({ mesh: wm, velocity: new THREE.Vector3(Math.cos(a) * s, 20 + Math.random() * 15, Math.sin(a) * s), lifetime: 0.8 + Math.random() * 0.3, maxLifetime: 1.1 });
      }
      // Damage non-ship enemies
      g.enemies.forEach(e => {
        if (!e.alive || e.type === 'ship') return;
        const d = e.mesh.position.distanceTo(dragon.position);
        if (d < 28) {
          const dmg = 90 + g.stats.level * 10; e.health -= dmg;
          createDmgNum(e.mesh.position.clone(), dmg);
          if (e.health <= 0) { e.alive = false; g.scene.remove(e.mesh); g.stats.xp += 30; g.stats.gold += 20; }
        }
      });
    }

    // Markers
    g.markers.forEach(mk => { if (!mk.visible) return; mk.traverse(c => { if (c.name === 'md') { c.rotation.y += dt * 2; c.position.y = 53 + Math.sin(Date.now() * 0.003) * 2; } if (c.name === 'mr') c.rotation.z += dt * 1.5; }); });

    // Ambient sound
    g.ambientT += dt;
    if (g.ambientT > 3) { g.ambientT = 0; sound.ambientOcean(); }

    // Clamp
    const b = 1800;
    dragon.position.x = Math.max(-b, Math.min(b, dragon.position.x));
    dragon.position.z = Math.max(-b, Math.min(b, dragon.position.z));
    if (dragon.position.y > 200) dragon.position.y = 200;

    // State
    setStats({ ...g.stats });
    if (g.mi < g.missions.length) { const m = g.missions[g.mi]; if (!m.completed) setCurrentMission({ ...m }); else if (g.mi === g.missions.length - 1) { setGameState('victory'); g.active = false; } }
    if (g.notifT > 0) { g.notifT -= dt; if (g.notifT <= 0) setNotification(''); }
    if (g.stats.health <= 0) { g.stats.health = 0; setGameState('gameover'); g.active = false; }

    g.composer.render(dt);
    g.animId = requestAnimationFrame(() => loopRef.current());
  }, [breatheFire, createDmgNum, enemyFire, notify, shootArrows]);

  useEffect(() => { loopRef.current = loop; }, [loop]);

  // ============================================================
  // INIT
  // ============================================================
  const initGame = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    sound.init();

    const scene = new THREE.Scene();
    const fog = new THREE.Color(0x1a2a4a);
    scene.fog = new THREE.FogExp2(fog, 0.001); scene.background = fog;

    const camera = new THREE.PerspectiveCamera(80, container.clientWidth / container.clientHeight, 0.1, 2500);
    camera.position.set(0, 25, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({ luminanceThreshold: 0.5, luminanceSmoothing: 0.3, intensity: 1.2 });
    composer.addPass(new EffectPass(camera, bloom));
    composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    composer.addPass(new EffectPass(camera, new VignetteEffect({ offset: 0.25, darkness: 0.4 })));

    const ambient = new THREE.AmbientLight(0x4466aa, 0.5); scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
    sun.position.set(150, 200, 100); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 800;
    sun.shadow.camera.left = -300; sun.shadow.camera.right = 300; sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300;
    sun.shadow.bias = -0.001; scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x88aacc, 0x224422, 0.4));

    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(20, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffee88 }));
    sunMesh.position.set(600, 400, 150); scene.add(sunMesh);

    // Moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 16), new THREE.MeshBasicMaterial({ color: 0xccccdd }));
    moon.position.set(-500, 300, -200); scene.add(moon);

    const { water, islands } = createOcean(scene);
    const dragonObj = createPlayerDragon(scene);
    const fireLight = dragonObj.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight;

    // Load GLB
    const loader = new GLTFLoader();
    loader.load('/models/demon_dragon.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(7.8, 7.8, 7.8); // Large dragon model
      // Store GLB base scale so level-up won't shrink it
      if (G.current) { G.current.baseScale = 7.8; G.current.dragonScale = 7.8; }
      model.position.copy(dragonObj.position); model.rotation.copy(dragonObj.rotation);
      model.traverse(c => { if (c instanceof THREE.Mesh) { c.castShadow = true; c.receiveShadow = true; } });
      const fl = new THREE.PointLight(0xff4400, 0, 35); fl.position.set(0, 2, -10); model.add(fl);
      scene.remove(dragonObj); scene.add(model);
      if (gltf.animations.length > 0) { const mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations[0]).play(); if (G.current) { G.current.mixer = mixer; } }
      if (G.current) { G.current.dragon = model; G.current.fireLight = fl; G.current.dragonModel = model; }
    }, undefined, () => console.warn('GLB load failed'));

    const enemies = spawnEnemies(scene);
    const missions = makeMissions();
    const markers = createMarkers(scene, missions);

    // Ocean mist particles
    const pGeo = new THREE.BufferGeometry(); const pPos = new Float32Array(600 * 3);
    for (let i = 0; i < pPos.length; i += 3) { pPos[i] = (Math.random() - 0.5) * 1000; pPos[i + 1] = Math.random() * 30 + WATER_Y; pPos[i + 2] = (Math.random() - 0.5) * 1000; }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x8899aa, size: 1, transparent: true, opacity: 0.15 })));

    const g = {
      scene, camera, renderer, composer, dragon: dragonObj, clock: new THREE.Clock(),
      keys: new Set<string>(), mouse: { dx: 0, dy: 0, down: false },
      stats: { health: 200, maxHealth: 200, stamina: 150, maxStamina: 150, hunger: 100, maxHunger: 100, xp: 0, level: 1, xpToNext: 80, territory: 0, gold: 0, breathFuel: 120, maxBreathFuel: 120 },
      enemies, projectiles: [], particles: [], dmgNums: [], missions, mi: 0, markers,
      isGrounded: true, isFlying: false, isBreathingFire: false, isDiving: false, isSprinting: false,
      diveVel: new THREE.Vector3(), dragonVel: new THREE.Vector3(), animId: 0, terrain: water,
      yaw: 0, pitch: 0, wingAngle: 0.3, wingDir: 1,
      hungerT: 0, staminaT: 0, fireT: 0, notifT: 0, dragonScale: 2.3, active: true,
      baseScale: 2.3,
      slowMo: 0, cinematicMode: false, cinematicTimer: 0, cinematicTarget: null,
      dayTime: Math.PI / 3, sun, sunMesh, ambient, fog,
      fireLight, dragonModel: null, mixer: null,
      camShake: 0, killStreak: 0, comboT: 0, bloom,
      water, islands, ambientT: 0,
    };
    G.current = g;
    setTimeout(() => { setCurrentMission(missions[0]); sound.startMusic(); }, 0);

    // Input
    const canvas = renderer.domElement;
    const reqLock = () => { if (!document.pointerLockElement) canvas.requestPointerLock(); };
    const onPLC = () => setIsLocked(!!document.pointerLockElement);
    const onMM = (e: MouseEvent) => { if (document.pointerLockElement === canvas) { g.mouse.dx += e.movementX; g.mouse.dy += e.movementY; } };
    const onMD = (e: MouseEvent) => { if (!document.pointerLockElement) { reqLock(); return; } if (e.button === 0) g.mouse.down = true; };
    const onMU = (e: MouseEvent) => { if (e.button === 0) g.mouse.down = false; };
    const onKD = (e: KeyboardEvent) => { g.keys.add(e.key.toLowerCase()); if (e.key === 'Escape') { if (document.pointerLockElement) document.exitPointerLock(); else setGameState(p => p === 'playing' ? 'paused' : 'playing'); } if (e.key === 'Tab') { e.preventDefault(); setShowControls(p => !p); } };
    const onKU = (e: KeyboardEvent) => g.keys.delete(e.key.toLowerCase());
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onResize = () => { const w = container.clientWidth, h = container.clientHeight; g.camera.aspect = w / h; g.camera.updateProjectionMatrix(); g.renderer.setSize(w, h); g.composer.setSize(w, h); };

    canvas.addEventListener('click', reqLock);
    document.addEventListener('pointerlockchange', onPLC);
    document.addEventListener('mousemove', onMM);
    window.addEventListener('mousedown', onMD);
    window.addEventListener('mouseup', onMU);
    window.addEventListener('keydown', onKD);
    window.addEventListener('keyup', onKU);
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('resize', onResize);

    g.animId = requestAnimationFrame(() => loopRef.current());

    return () => {
      g.active = false; cancelAnimationFrame(g.animId); sound.stopMusic();
      if (document.pointerLockElement) document.exitPointerLock();
      canvas.removeEventListener('click', reqLock);
      document.removeEventListener('pointerlockchange', onPLC);
      document.removeEventListener('mousemove', onMM);
      window.removeEventListener('mousedown', onMD);
      window.removeEventListener('mouseup', onMU);
      window.removeEventListener('keydown', onKD);
      window.removeEventListener('keyup', onKU);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [createOcean, createPlayerDragon, createMarkers, makeMissions, spawnEnemies]);

  useEffect(() => { if (gameState !== 'playing') return; return initGame(); }, [gameState, initGame]);

  if (!mounted) return <div className="w-full h-screen flex items-center justify-center bg-gray-900"><div className="text-center"><h1 className="text-4xl font-bold text-amber-500 mb-4">DRAGON&apos;S REIGN</h1><p className="text-amber-200/60 animate-pulse">Loading...</p></div></div>;

  return (
    <div className="w-full h-screen relative overflow-hidden bg-black" ref={containerRef}>
      {gameState === 'menu' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-blue-950 via-gray-900 to-blue-950">
          <div className="text-center">
            <div className="text-8xl mb-4">🐉</div>
            <h1 className="text-7xl font-black text-amber-400 mb-2 tracking-widest" style={{ textShadow: '0 0 60px rgba(217,119,6,0.6)' }}>DRAGON&apos;S REIGN</h1>
            <p className="text-xl text-blue-200/60 mb-1 tracking-wider">OCEAN SURVIVAL</p>
            <p className="text-sm text-gray-500 mb-10">Open Ocean • Dragon Combat • Naval Warfare</p>
            <button onClick={() => setGameState('playing')} className="px-14 py-5 bg-gradient-to-r from-blue-900 to-red-800 hover:from-blue-800 hover:to-red-700 text-amber-100 text-2xl font-black rounded-xl border-2 border-amber-500/40 shadow-2xl shadow-blue-900/60 transition-all hover:scale-110 mb-8">BEGIN CONQUEST</button>
            <div className="mt-6 text-gray-500 text-xs space-y-1 max-w-lg mx-auto">
              <p>WASD — Move | Space — Fly Up | Shift — Fly Down | E — Sprint</p>
              <p>Mouse — Look | Left Click — Fire Breath (Auto-Aim) | M — Dive</p>
              <p>R — Roar Stun | Tab — Controls | Esc — Pause</p>
            </div>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <>
          <div className="absolute top-4 left-4 z-30 space-y-1.5 min-w-[220px]">
            {[{ l: 'HEALTH', v: stats.health, m: stats.maxHealth, c: 'from-red-800 to-red-500', b: 'border-red-900/30', t: 'text-red-400' },
              { l: 'STAMINA', v: stats.stamina, m: stats.maxStamina, c: 'from-yellow-800 to-yellow-400', b: 'border-yellow-900/30', t: 'text-yellow-400' },
              { l: 'HUNGER', v: stats.hunger, m: stats.maxHunger, c: 'from-green-800 to-green-400', b: 'border-green-900/30', t: 'text-green-400' },
              { l: 'BREATH', v: stats.breathFuel, m: stats.maxBreathFuel, c: 'from-orange-800 to-orange-400', b: 'border-orange-900/30', t: 'text-orange-400' },
            ].map(s => (
              <div key={s.l} className={`bg-black/70 rounded-lg p-1.5 backdrop-blur-sm ${s.b} border`}>
                <div className="flex items-center justify-between mb-0.5"><span className={`${s.t} text-[10px] font-bold`}>{s.l}</span><span className={`${s.t} text-[10px] opacity-70`}>{Math.round(s.v)}/{s.m}</span></div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden"><div className={`h-full bg-gradient-to-r ${s.c} rounded-full transition-all`} style={{ width: `${(s.v / s.m) * 100}%` }} /></div>
              </div>
            ))}
            <div className="bg-black/70 rounded-lg p-1.5 backdrop-blur-sm border border-amber-900/30">
              <div className="flex items-center justify-between mb-0.5"><span className="text-amber-400 text-[10px] font-bold">LVL {stats.level}</span><span className="text-amber-300 text-[10px] opacity-70">{stats.xp}/{stats.xpToNext}</span></div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-all" style={{ width: `${(stats.xp / stats.xpToNext) * 100}%` }} /></div>
            </div>
            <div className="flex gap-2">
              <div className="bg-black/70 rounded-lg px-2 py-1 backdrop-blur-sm border border-amber-900/30 flex-1"><span className="text-amber-400 text-[9px] font-bold">GOLD </span><span className="text-amber-300 text-[9px]">{stats.gold}</span></div>
            </div>
          </div>

          {currentMission && (
            <div className="absolute top-4 right-4 z-30 max-w-xs">
              <div className="bg-black/70 rounded-lg p-3 backdrop-blur-sm border border-amber-900/30">
                <h3 className="text-amber-400 text-xs font-bold mb-1">MISSION {currentMission.id}: {currentMission.title}</h3>
                <p className="text-gray-300 text-[10px] mb-2">{currentMission.description}</p>
                <div className="flex items-center justify-between"><span className="text-gray-400 text-[10px]">{currentMission.objective}</span><span className="text-amber-300 text-xs font-bold">{currentMission.currentCount}/{currentMission.targetCount}</span></div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mt-1"><div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-all" style={{ width: `${(currentMission.currentCount / currentMission.targetCount) * 100}%` }} /></div>
                <p className="text-green-400/80 text-[10px] mt-1">{currentMission.reward}</p>
                <p className="text-amber-200/50 text-[9px] mt-1">📍 Follow the glowing beacon!</p>
              </div>
            </div>
          )}

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="w-1 h-1 bg-amber-400 rounded-full shadow-lg shadow-amber-400/50" />
          </div>

          {!isLocked && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40">
              <div className="bg-black/80 text-amber-200 px-8 py-4 rounded-xl text-lg font-bold border border-amber-500/50 backdrop-blur-md cursor-pointer">🖱️ Click to control camera</div>
            </div>
          )}

          {notification && <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-40 pointer-events-none"><div className="bg-amber-900/80 text-amber-200 px-8 py-4 rounded-xl text-lg font-black border border-amber-500/50 backdrop-blur-md" style={{ textShadow: '0 0 10px rgba(217,119,6,0.5)' }}>{notification}</div></div>}

          {showControls && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
              <div className="bg-black/90 rounded-xl p-6 backdrop-blur-md border border-amber-800/40 min-w-[360px]">
                <h3 className="text-amber-400 text-xl font-black mb-4 text-center">CONTROLS</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[['W', 'Forward'], ['S', 'Backward'], ['A', 'Strafe Left'], ['D', 'Strafe Right'], ['Mouse', 'Look Around'], ['Space', 'Fly Up'], ['Shift', 'Fly Down'], ['E', 'Sprint'], ['LClick', 'Fire Breath (Auto-Aim)'], ['M', 'Dive Attack'], ['R', 'Roar Stun'], ['Esc', 'Pause']].map(([k, d]) => <React.Fragment key={k}><div className="text-gray-400">{k}</div><div className="text-gray-200">{d}</div></React.Fragment>)}
                </div>
              </div>
            </div>
          )}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <div className="bg-black/60 rounded-full px-4 py-1 backdrop-blur-sm border border-gray-700/30">
              <span className="text-xs text-gray-300">{stats.stamina < 10 ? '⚠ EXHAUSTED' : isLocked ? '⚔ Combat Ready' : '🖱️ Click to control'}</span>
            </div>
          </div>
        </>
      )}

      {gameState === 'paused' && <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md"><h2 className="text-5xl font-black text-amber-400 mb-8">PAUSED</h2><button onClick={() => setGameState('playing')} className="px-10 py-4 bg-blue-900 hover:bg-blue-800 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-600/40 transition-all hover:scale-105 mb-4">RESUME</button><button onClick={() => setGameState('menu')} className="px-10 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-lg rounded-xl border border-gray-600/40 transition-all hover:scale-105">MAIN MENU</button></div>}

      {gameState === 'gameover' && <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-black via-blue-950/80 to-black"><div className="text-7xl mb-4">💀</div><h2 className="text-6xl font-black text-red-500 mb-4">FALLEN</h2><p className="text-gray-400 text-lg mb-2">Your reign over the seas has ended.</p><p className="text-amber-400 mb-8">Level {stats.level} | Gold: {stats.gold}</p><button onClick={() => setGameState('menu')} className="px-10 py-4 bg-red-800 hover:bg-red-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-600/40 transition-all hover:scale-105">TRY AGAIN</button></div>}

      {gameState === 'victory' && <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-amber-950 via-gray-900 to-amber-950"><div className="text-7xl mb-4">👑</div><h2 className="text-6xl font-black text-amber-400 mb-4" style={{ textShadow: '0 0 50px rgba(217,119,6,0.6)' }}>KING OF THE SEAS</h2><p className="text-amber-200/80 text-lg mb-2">The Leviathan has fallen. You rule the ocean.</p><p className="text-amber-400 mb-8">Level {stats.level} | Gold: {stats.gold}</p><button onClick={() => setGameState('menu')} className="px-10 py-4 bg-amber-800 hover:bg-amber-700 text-amber-100 text-xl font-bold rounded-xl border-2 border-amber-500/40 transition-all hover:scale-105">PLAY AGAIN</button></div>}
    </div>
  );
}
