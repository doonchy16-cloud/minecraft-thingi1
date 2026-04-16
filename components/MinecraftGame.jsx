'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS, HOTBAR_ORDER, INITIAL_INVENTORY, blockLabel, createBlockTexturePatterns, getDropForBlock } from '../lib/blockTypes';
import { RECIPES, applyRecipe, canCraft } from '../lib/recipes';
import { collidesWorld, getBaseBlock, getBlock, isExposed, keyOf, raycastVoxel, terrainHeight } from '../lib/world';

const PLAYER_SIZE = { radius: 0.32, height: 1.8, eyeHeight: 1.62 };
const GRAVITY = 28;
const MOVE_SPEED = 5.6;
const JUMP_SPEED = 9.8;
const REACH = 6;
const RENDER_RADIUS = 18;
const MAX_BASE_RENDER_HEIGHT = 26;
const MAX_HEALTH = 10;
const SUN_SPEED = 0.018;

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const int = Number.parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function createPixelTexture(palette, label = 'all') {
  const size = 16;
  const data = new Uint8Array(size * size * 4);

  const colorAt = (x, y) => {
    const i = (x * 3 + y * 5 + ((x ^ y) % 4)) % palette.length;
    return hexToRgb(palette[i]);
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      let { r, g, b } = colorAt(x, y);
      let a = 255;

      if (label === 'top' && y < 3) {
        r = Math.min(255, Math.round(r * 1.14));
        g = Math.min(255, Math.round(g * 1.14));
        b = Math.min(255, Math.round(b * 1.14));
      }

      if (label === 'side' && y > 10) {
        r = Math.max(0, Math.round(r * 0.88));
        g = Math.max(0, Math.round(g * 0.88));
        b = Math.max(0, Math.round(b * 0.88));
      }

      if (label === 'front' && x >= 2 && x <= 13 && y >= 5 && y <= 11) {
        r = Math.max(0, Math.round(r * 0.82));
        g = Math.max(0, Math.round(g * 0.82));
        b = Math.max(0, Math.round(b * 0.82));
        if (x >= 4 && x <= 11 && y >= 7 && y <= 9) {
          a = 0;
        }
      }

      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = a;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function useBlockMaterials() {
  return useMemo(() => {
    const patterns = createBlockTexturePatterns();
    const materials = {};

    Object.entries(patterns).forEach(([id, pattern]) => {
      const transparent = Boolean(pattern.transparent);
      materials[id] = [
        new THREE.MeshStandardMaterial({ map: createPixelTexture(pattern.side ?? pattern.all, 'side'), transparent, alphaTest: transparent ? 0.25 : 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: createPixelTexture(pattern.side ?? pattern.all, 'side'), transparent, alphaTest: transparent ? 0.25 : 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: createPixelTexture(pattern.top ?? pattern.all, 'top'), transparent, alphaTest: transparent ? 0.25 : 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: createPixelTexture(pattern.bottom ?? pattern.all, 'bottom'), transparent, alphaTest: transparent ? 0.25 : 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: createPixelTexture(pattern.front ?? pattern.side ?? pattern.all, 'front'), transparent, alphaTest: transparent ? 0.25 : 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: createPixelTexture(pattern.side ?? pattern.all, 'side'), transparent, alphaTest: transparent ? 0.25 : 0, roughness: 1 }),
      ];
    });

    return materials;
  }, []);
}

function VoxelLayer({ positions, materials }) {
  const ref = useRef(null);
  const temp = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    positions.forEach((pos, index) => {
      temp.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
      temp.updateMatrix();
      ref.current.setMatrixAt(index, temp.matrix);
    });

    ref.current.count = positions.length;
    ref.current.instanceMatrix.needsUpdate = true;
  }, [positions, temp]);

  if (!positions.length) {
    return null;
  }

  return (
    <instancedMesh ref={ref} args={[null, null, positions.length]} material={materials} castShadow receiveShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

function EnemyMeshes({ mobsRef, snapshotVersion }) {
  const group = useRef(null);

  useFrame(() => {
    if (!group.current) {
      return;
    }

    group.current.children.forEach((child, index) => {
      const mob = mobsRef.current[index];
      if (!mob) {
        return;
      }
      child.position.set(mob.position.x, mob.position.y + 0.55, mob.position.z);
    });
  });

  return (
    <group ref={group} key={snapshotVersion}>
      {mobsRef.current.map((mob) => (
        <mesh key={mob.id} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.9, 0.9]} />
          <meshStandardMaterial color={mob.kind === 'slime' ? '#6ecc45' : '#b2583b'} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function SelectionBox({ target }) {
  if (!target) {
    return null;
  }

  return (
    <lineSegments position={[target.x + 0.5, target.y + 0.5, target.z + 0.5]}>
      <edgesGeometry args={[new THREE.BoxGeometry(1.02, 1.02, 1.02)]} />
      <lineBasicMaterial color="#ffffff" />
    </lineSegments>
  );
}

function SkyAndLights({ timeRef }) {
  const sunRef = useRef(null);
  const moonRef = useRef(null);
  const { scene } = useThree();
  const sky = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const sunAngle = timeRef.current * Math.PI * 2;
    const radius = 80;
    const sunY = Math.sin(sunAngle) * radius;
    const sunX = Math.cos(sunAngle) * radius;
    const dayFactor = Math.max(0, Math.sin(sunAngle));

    if (sunRef.current) {
      sunRef.current.position.set(sunX, sunY, 24);
      sunRef.current.intensity = 0.15 + dayFactor * 1.4;
      sunRef.current.target.position.set(0, 0, 0);
      sunRef.current.target.updateMatrixWorld();
    }

    if (moonRef.current) {
      moonRef.current.position.set(-sunX, -sunY, -24);
      moonRef.current.intensity = 0.05 + (1 - dayFactor) * 0.25;
      moonRef.current.target.position.set(0, 0, 0);
      moonRef.current.target.updateMatrixWorld();
    }

    const t = Math.max(0, Math.min(1, dayFactor * 0.9 + 0.1));
    sky.setRGB(0.06 + 0.48 * t, 0.08 + 0.62 * t, 0.14 + 0.72 * t);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 30, 120);
  });

  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight ref={sunRef} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} />
      <directionalLight ref={moonRef} />
    </>
  );
}

function WorldScene({
  editsRef,
  renderAnchor,
  editsVersion,
  target,
  timeRef,
  onPlayerSample,
  onTargetChange,
  onTimeSample,
  isLocked,
  mobsRef,
  mobVersion,
  setSnapshotVersion,
  healthRef,
  setHealth,
  aimRef,
  playerStateRef,
}) {
  const materials = useBlockMaterials();
  const controlsRef = useRef(null);
  const keysRef = useRef({});
  const velocityRef = useRef(new THREE.Vector3());
  const playerRef = useRef({ position: new THREE.Vector3(0, terrainHeight(0, 0) + 1.1, 0), onGround: false, lastDamageAt: 0 });
  const targetRef = useRef(null);
  const sampleClockRef = useRef(0);
  const timeSampleRef = useRef(0);
  const mobSpawnRef = useRef(0);
  const { camera, gl } = useThree();
  const direction = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const horizontal = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(0, terrainHeight(0, 0) + PLAYER_SIZE.eyeHeight + 1.1, 0);
  }, [camera]);

  useEffect(() => {
    const down = (event) => {
      keysRef.current[event.code] = true;
    };
    const up = (event) => {
      keysRef.current[event.code] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const blockPositions = useMemo(() => {
    const groups = new Map();
    HOTBAR_ORDER.concat(BLOCK.LEAVES).forEach((id) => groups.set(id, []));

    for (let x = renderAnchor.x - RENDER_RADIUS; x <= renderAnchor.x + RENDER_RADIUS; x += 1) {
      for (let z = renderAnchor.z - RENDER_RADIUS; z <= renderAnchor.z + RENDER_RADIUS; z += 1) {
        const columnMaxY = Math.min(MAX_BASE_RENDER_HEIGHT, terrainHeight(x, z) + 7);
        for (let y = 0; y <= columnMaxY; y += 1) {
          const id = getBlock(x, y, z, editsRef.current);
          if (id !== BLOCK.AIR && isExposed(x, y, z, editsRef.current)) {
            if (!groups.has(id)) {
              groups.set(id, []);
            }
            groups.get(id).push([x, y, z]);
          }
        }
      }
    }

    editsRef.current.forEach((value, key) => {
      if (value === BLOCK.AIR) {
        return;
      }
      const [x, y, z] = key.split(',').map(Number);
      if (Math.abs(x - renderAnchor.x) > RENDER_RADIUS || Math.abs(z - renderAnchor.z) > RENDER_RADIUS) {
        return;
      }
      if (isExposed(x, y, z, editsRef.current)) {
        if (!groups.has(value)) {
          groups.set(value, []);
        }
        const alreadyIncluded = groups.get(value).some((pos) => pos[0] === x && pos[1] === y && pos[2] === z);
        if (!alreadyIncluded) {
          groups.get(value).push([x, y, z]);
        }
      }
    });

    return groups;
  }, [editsRef, editsVersion, renderAnchor.x, renderAnchor.z]);

  useFrame((_, delta) => {
    timeRef.current = (timeRef.current + delta * SUN_SPEED) % 1;

    const player = playerRef.current;
    const keys = keysRef.current;
    const velocity = velocityRef.current;

    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) {
      forward.set(0, 0, -1);
    }
    forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    horizontal.set(0, 0, 0);
    if (keys.KeyW) {
      horizontal.add(forward);
    }
    if (keys.KeyS) {
      horizontal.sub(forward);
    }
    if (keys.KeyA) {
      horizontal.sub(right);
    }
    if (keys.KeyD) {
      horizontal.add(right);
    }
    if (horizontal.lengthSq() > 0) {
      horizontal.normalize().multiplyScalar(MOVE_SPEED);
    }

    velocity.x = horizontal.x;
    velocity.z = horizontal.z;
    velocity.y -= GRAVITY * delta;

    if (player.onGround && keys.Space) {
      velocity.y = JUMP_SPEED;
      player.onGround = false;
    }

    const nextPos = player.position.clone();
    nextPos.x += velocity.x * delta;
    if (!collidesWorld(nextPos, PLAYER_SIZE, editsRef.current)) {
      player.position.x = nextPos.x;
    }

    nextPos.copy(player.position);
    nextPos.z += velocity.z * delta;
    if (!collidesWorld(nextPos, PLAYER_SIZE, editsRef.current)) {
      player.position.z = nextPos.z;
    }

    nextPos.copy(player.position);
    nextPos.y += velocity.y * delta;
    if (!collidesWorld(nextPos, PLAYER_SIZE, editsRef.current)) {
      player.position.y = nextPos.y;
      player.onGround = false;
    } else {
      if (velocity.y < 0) {
        player.onGround = true;
      }
      velocity.y = 0;
    }

    if (player.position.y < -20) {
      player.position.set(0, terrainHeight(0, 0) + 1.1, 0);
      velocity.set(0, 0, 0);
    }

    camera.position.set(player.position.x, player.position.y + PLAYER_SIZE.eyeHeight, player.position.z);
    playerStateRef.current = { x: player.position.x, y: player.position.y, z: player.position.z, onGround: player.onGround };

    camera.getWorldDirection(direction);
    aimRef.current.copy(direction);
    const hit = raycastVoxel(camera.position, direction, REACH, editsRef.current);
    const nextTarget = hit ? hit.block : null;
    const prevTarget = targetRef.current;
    if (
      (nextTarget && !prevTarget) ||
      (!nextTarget && prevTarget) ||
      (nextTarget && prevTarget && (nextTarget.x !== prevTarget.x || nextTarget.y !== prevTarget.y || nextTarget.z !== prevTarget.z))
    ) {
      targetRef.current = nextTarget;
      onTargetChange(nextTarget);
    }

    const isNight = timeRef.current > 0.58 || timeRef.current < 0.16;
    mobSpawnRef.current += delta;
    if (isNight && mobSpawnRef.current > 2.6 && mobsRef.current.length < 6) {
      mobSpawnRef.current = 0;
      const angle = Math.random() * Math.PI * 2;
      const distance = 10 + Math.random() * 10;
      const spawnX = Math.round(player.position.x + Math.cos(angle) * distance);
      const spawnZ = Math.round(player.position.z + Math.sin(angle) * distance);
      const spawnY = terrainHeight(spawnX, spawnZ) + 1;
      mobsRef.current.push({
        id: crypto.randomUUID(),
        position: { x: spawnX + 0.5, y: spawnY, z: spawnZ + 0.5 },
        hp: 3,
        kind: Math.random() < 0.6 ? 'slime' : 'golem',
      });
      setSnapshotVersion((value) => value + 1);
    }

    mobsRef.current = mobsRef.current
      .map((mob) => {
        const dx = player.position.x - mob.position.x;
        const dz = player.position.z - mob.position.z;
        const dist = Math.hypot(dx, dz);
        const groundY = terrainHeight(Math.floor(mob.position.x), Math.floor(mob.position.z)) + 1;

        if (isNight && dist < 24 && dist > 1.15) {
          mob.position.x += (dx / dist) * delta * 1.8;
          mob.position.z += (dz / dist) * delta * 1.8;
        }
        mob.position.y = groundY;

        if (!isNight && dist > 26) {
          return null;
        }

        if (dist < 1.4) {
          const now = performance.now();
          if (now - player.lastDamageAt > 1000) {
            player.lastDamageAt = now;
            healthRef.current = Math.max(0, healthRef.current - 1);
            setHealth(healthRef.current);
          }
        }

        return mob.hp > 0 ? mob : null;
      })
      .filter(Boolean);

    sampleClockRef.current += delta;
    timeSampleRef.current += delta;
    if (sampleClockRef.current > 0.12) {
      sampleClockRef.current = 0;
      const snapshot = {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        onGround: player.onGround,
      };
      playerStateRef.current = snapshot;
      onPlayerSample(snapshot);
      setSnapshotVersion((value) => value + 1);
    }
    if (timeSampleRef.current > 0.25) {
      timeSampleRef.current = 0;
      onTimeSample(timeRef.current);
    }
  });

  useEffect(() => {
    const onLockChange = () => {
      const locked = document.pointerLockElement === gl.domElement;
      if (!locked) {
        keysRef.current = {};
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, [gl.domElement]);

  return (
    <>
      <SkyAndLights timeRef={timeRef} />
      <PointerLockControls ref={controlsRef} selector="#play-button" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[800, 800]} />
        <meshStandardMaterial color="#2f5a2f" />
      </mesh>
      {Array.from(blockPositions.entries()).map(([blockId, positions]) => (
        <VoxelLayer key={blockId} positions={positions} materials={materials[blockId]} />
      ))}
      <EnemyMeshes mobsRef={mobsRef} snapshotVersion={mobVersion} />
      <SelectionBox target={target} />
    </>
  );
}

function hearts(health) {
  return Array.from({ length: MAX_HEALTH }, (_, index) => (index < health ? '♥' : '♡')).join(' ');
}

export default function MinecraftGame() {
  const editsRef = useRef(new Map());
  const healthRef = useRef(MAX_HEALTH);
  const mobsRef = useRef([]);
  const aimRef = useRef(new THREE.Vector3(0, 0, -1));
  const timeRef = useRef(0.23);
  const playerStateRef = useRef({ x: 0, y: terrainHeight(0, 0) + 1.1, z: 0, onGround: false });
  const [playerSample, setPlayerSample] = useState({ x: 0, y: 0, z: 0, onGround: false });
  const [renderAnchor, setRenderAnchor] = useState({ x: 0, z: 0 });
  const [editsVersion, setEditsVersion] = useState(0);
  const [target, setTarget] = useState(null);
  const [timeOfDay, setTimeOfDay] = useState(0.23);
  const [health, setHealth] = useState(MAX_HEALTH);
  const [inventory, setInventory] = useState(INITIAL_INVENTORY);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [message, setMessage] = useState('Click Play to lock the cursor and start mining.');
  const [showCrafting, setShowCrafting] = useState(true);
  const [isLocked, setIsLocked] = useState(true);
  const [mobVersion, setMobVersion] = useState(0);

  const selectedBlock = HOTBAR_ORDER[selectedSlot];
  const messageTimerRef = useRef(null);

  const setToast = useCallback((text) => {
    setMessage(text);
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = window.setTimeout(() => {
      setMessage('');
    }, 2400);
  }, []);

  const setWorldBlock = useCallback((x, y, z, nextBlock) => {
    const key = keyOf(x, y, z);
    const base = getBaseBlock(x, y, z);
    if (nextBlock === base) {
      editsRef.current.delete(key);
    } else {
      editsRef.current.set(key, nextBlock);
    }
    setEditsVersion((value) => value + 1);
  }, []);

  const damageMobInFront = useCallback(() => {
    const currentPlayer = playerStateRef.current;
    const playerPos = new THREE.Vector3(currentPlayer.x, currentPlayer.y + PLAYER_SIZE.eyeHeight, currentPlayer.z);
    const cameraDir = aimRef.current.clone().normalize();
    const best = { mob: null, score: Number.POSITIVE_INFINITY };

    mobsRef.current.forEach((mob) => {
      const toMob = new THREE.Vector3(mob.position.x, mob.position.y + 0.3, mob.position.z).sub(playerPos);
      const distance = toMob.length();
      if (distance > 4.5) {
        return;
      }
      toMob.normalize();
      const alignment = cameraDir.dot(toMob);
      if (alignment < 0.93) {
        return;
      }
      const score = distance - alignment;
      if (score < best.score) {
        best.mob = mob;
        best.score = score;
      }
    });

    if (!best.mob) {
      return false;
    }

    best.mob.hp -= 1;
    if (best.mob.hp <= 0) {
      setInventory((current) => ({ ...current, [BLOCK.STONE]: (current[BLOCK.STONE] ?? 0) + 1 }));
      setToast('Mob defeated. +1 stone');
    } else {
      setToast('Hit!');
    }
    setMobVersion((value) => value + 1);
    return true;
  }, [setToast]);

  const breakTargetBlock = useCallback(() => {
    if (!target) {
      return;
    }

    if (damageMobInFront()) {
      return;
    }

    const blockId = getBlock(target.x, target.y, target.z, editsRef.current);
    if (blockId === BLOCK.AIR) {
      return;
    }

    setWorldBlock(target.x, target.y, target.z, BLOCK.AIR);
    const drop = getDropForBlock(blockId);
    if (drop !== BLOCK.AIR) {
      setInventory((current) => ({ ...current, [drop]: (current[drop] ?? 0) + 1 }));
      setToast(`Collected ${blockLabel(drop)}.`);
    }
  }, [damageMobInFront, setToast, setWorldBlock, target]);

  const placeTargetBlock = useCallback(() => {
    if (!target) {
      return;
    }

    const hit = raycastVoxel(
      new THREE.Vector3(playerStateRef.current.x, playerStateRef.current.y + PLAYER_SIZE.eyeHeight, playerStateRef.current.z),
      aimRef.current.clone().normalize(),
      REACH,
      editsRef.current,
    );

    const inventoryCount = inventory[selectedBlock] ?? 0;
    if (!hit || inventoryCount <= 0) {
      return;
    }

    const placeX = hit.block.x + hit.faceNormal.x;
    const placeY = hit.block.y + hit.faceNormal.y;
    const placeZ = hit.block.z + hit.faceNormal.z;

    if (getBlock(placeX, placeY, placeZ, editsRef.current) !== BLOCK.AIR) {
      return;
    }

    const playerBody = new THREE.Vector3(playerStateRef.current.x, playerStateRef.current.y, playerStateRef.current.z);
    const wouldIntersectPlayer = !(playerBody.x + PLAYER_SIZE.radius <= placeX || playerBody.x - PLAYER_SIZE.radius >= placeX + 1 || playerBody.y + PLAYER_SIZE.height <= placeY || playerBody.y >= placeY + 1 || playerBody.z + PLAYER_SIZE.radius <= placeZ || playerBody.z - PLAYER_SIZE.radius >= placeZ + 1);
    if (wouldIntersectPlayer) {
      setToast('Cannot place a block inside the player.');
      return;
    }

    setWorldBlock(placeX, placeY, placeZ, selectedBlock);
    setInventory((current) => ({ ...current, [selectedBlock]: Math.max(0, (current[selectedBlock] ?? 0) - 1) }));
    setToast(`Placed ${blockLabel(selectedBlock)}.`);
  }, [inventory, selectedBlock, setToast, setWorldBlock, target]);

  useEffect(() => {
    const keydown = (event) => {
      if (/Digit[1-6]/.test(event.code)) {
        setSelectedSlot(Number(event.code.replace('Digit', '')) - 1);
      }
      if (event.code === 'KeyC') {
        setShowCrafting((value) => !value);
      }
      if (event.code === 'Escape') {
        setIsLocked(false);
      }
    };

    const wheel = (event) => {
      setSelectedSlot((current) => {
        const delta = event.deltaY > 0 ? 1 : -1;
        return (current + delta + HOTBAR_ORDER.length) % HOTBAR_ORDER.length;
      });
    };

    const click = (event) => {
      if (!document.pointerLockElement) {
        return;
      }
      if (event.button === 0) {
        breakTargetBlock();
      }
      if (event.button === 2) {
        event.preventDefault();
        placeTargetBlock();
      }
    };

    const preventContextMenu = (event) => event.preventDefault();

    window.addEventListener('keydown', keydown);
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('mousedown', click);
    window.addEventListener('contextmenu', preventContextMenu);

    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('mousedown', click);
      window.removeEventListener('contextmenu', preventContextMenu);
    };
  }, [breakTargetBlock, placeTargetBlock]);

  useEffect(() => {
    const anchorX = Math.round(playerSample.x);
    const anchorZ = Math.round(playerSample.z);
    if (Math.abs(anchorX - renderAnchor.x) >= 2 || Math.abs(anchorZ - renderAnchor.z) >= 2) {
      setRenderAnchor({ x: anchorX, z: anchorZ });
    }
  }, [playerSample.x, playerSample.z, renderAnchor.x, renderAnchor.z]);

  useEffect(() => {
    const onLockChange = () => {
      const locked = Boolean(document.pointerLockElement);
      setIsLocked(locked);
      if (!locked) {
        setMessage('Cursor unlocked. Click Play to continue.');
      }
    };

    document.addEventListener('pointerlockchange', onLockChange);
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, []);

  useEffect(() => {
    if (health <= 0) {
      healthRef.current = MAX_HEALTH;
      setHealth(MAX_HEALTH);
      setToast('You respawned.');
    }
  }, [health, setToast]);

  const craftRecipe = (recipe) => {
    if (!canCraft(recipe, inventory)) {
      return;
    }
    const next = applyRecipe(recipe, inventory);
    setInventory(next);
    setToast(`Crafted ${recipe.name}.`);
  };

  return (
    <div className="game-shell">
      <div className="hud top-left">
        <div className="panel title-panel">
          <h1>MiniCraft 3D</h1>
          <p>A small Minecraft-style prototype built for the browser.</p>
        </div>
        <div className="panel stats-panel">
          <div><strong>Health:</strong> <span className="hearts">{hearts(health)}</span></div>
          <div><strong>Coords:</strong> {playerSample.x.toFixed(1)}, {playerSample.y.toFixed(1)}, {playerSample.z.toFixed(1)}</div>
          <div><strong>Time:</strong> {timeOfDay > 0.58 || timeOfDay < 0.16 ? 'Night' : 'Day'}</div>
          <div><strong>Target:</strong> {target ? `${target.x}, ${target.y}, ${target.z}` : 'None'}</div>
        </div>
      </div>

      <div className="hud top-right">
        <div className="panel controls-panel">
          <h2>Controls</h2>
          <ul>
            <li>WASD move</li>
            <li>Space jump</li>
            <li>Left click break / hit</li>
            <li>Right click place</li>
            <li>1-6 or mouse wheel switch block</li>
            <li>C toggle crafting</li>
            <li>Esc unlock cursor</li>
          </ul>
          <button id="play-button" className="play-button" onClick={() => { setIsLocked(true); setMessage('Cursor locked. Explore, mine, craft, and build.'); }}>Play</button>
        </div>
        {showCrafting ? (
          <div className="panel crafting-panel">
            <h2>Crafting</h2>
            {RECIPES.map((recipe) => (
              <button key={recipe.id} className="craft-btn" disabled={!canCraft(recipe, inventory)} onClick={() => craftRecipe(recipe)}>
                <span>{recipe.name}</span>
                <small>{recipe.description}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="hud bottom-left">
        <div className="panel inventory-panel">
          <h2>Inventory</h2>
          <div className="inventory-grid">
            {HOTBAR_ORDER.concat(BLOCK.LEAVES).map((blockId) => (
              <div key={blockId} className="inventory-row">
                <span>{blockLabel(blockId)}</span>
                <strong>{inventory[blockId] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="hud bottom-center">
        <div className="hotbar">
          {HOTBAR_ORDER.map((blockId, index) => (
            <button key={blockId} className={`slot ${index === selectedSlot ? 'selected' : ''}`} onClick={() => setSelectedSlot(index)}>
              <span>{index + 1}</span>
              <strong>{blockLabel(blockId)}</strong>
              <em>{inventory[blockId] ?? 0}</em>
            </button>
          ))}
        </div>
        <div className="crosshair" />
        {message ? <div className="message">{message}</div> : null}
      </div>

      <Canvas shadows camera={{ fov: 75, near: 0.1, far: 180 }} gl={{ antialias: false }} dpr={[1, 1.5]}>
        <WorldScene
          editsRef={editsRef}
          renderAnchor={renderAnchor}
          editsVersion={editsVersion}
          target={target}
          timeRef={timeRef}
          onPlayerSample={setPlayerSample}
          onTargetChange={setTarget}
          onTimeSample={setTimeOfDay}
          isLocked={isLocked}
          mobsRef={mobsRef}
          mobVersion={mobVersion}
          setSnapshotVersion={setMobVersion}
          healthRef={healthRef}
          setHealth={setHealth}
          aimRef={aimRef}
          playerStateRef={playerStateRef}
        />
      </Canvas>
    </div>
  );
}
