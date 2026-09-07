import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = [number, number, number];
type Health = { accessVlanOk: boolean; branchLanAdvertised: boolean; endToEnd: boolean };

export function createNetworkRoom(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const textures: THREE.Texture[] = [];
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const obstacles: THREE.Box3[] = [];
  const pulseLights: THREE.Mesh[] = [];
  const graphite = new THREE.MeshStandardMaterial({ color: 0x282b2e, roughness: 0.46, metalness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0d1115, roughness: 0.64 });
  const silver = new THREE.MeshStandardMaterial({ color: 0x8e9599, roughness: 0.32, metalness: 0.8 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xb3b7b8, roughness: 0.86 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd1b34b, roughness: 0.62 });
  const green = new THREE.MeshStandardMaterial({ color: 0x70ecb0, emissive: 0x3bd697, emissiveIntensity: 2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffba57, emissive: 0xff7c22, emissiveIntensity: 2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xe76357, emissive: 0xe13927, emissiveIntensity: 1.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff9ec, emissive: 0xfff6df, emissiveIntensity: 3.5 });
  const materials = new Set<THREE.Material>([graphite, black, silver, wall, yellow, green, amber, red, lamp]);

  function texture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    draw(ctx);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    textures.push(map);
    return { canvas, ctx, map };
  }

  // Static details are merged by material so the thousands of ports and vents
  // add visual detail without adding a draw call for every part.
  function add(geometry: THREE.BufferGeometry, position: Point, material: THREE.Material, rotation: Point = [0, 0, 0]) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    const entries = batches.get(material) ?? [];
    entries.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
    batches.set(material, entries);
    materials.add(material);
  }
  function box(size: Point, pos: Point, mat: THREE.Material, bevel = 0, rot: Point = [0, 0, 0]) {
    add(bevel ? new RoundedBoxGeometry(...size, 2, bevel) : new THREE.BoxGeometry(...size), pos, mat, rot);
  }
  function tube(points: Point[], mat: THREE.Material, radius = 0.012) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    add(new THREE.TubeGeometry(curve, 24, radius, 6, false), [0, 0, 0], mat);
  }
  function obstacle(x: number, z: number, width: number, depth: number) {
    obstacles.push(new THREE.Box3(new THREE.Vector3(x - width / 2 - 0.22, 0, z - depth / 2 - 0.22), new THREE.Vector3(x + width / 2 + 0.22, 3, z + depth / 2 + 0.22)));
  }
  function panel(map: THREE.Texture, size: [number, number], pos: Point, emissive = false, rotation: Point = [0, 0, 0]) {
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ map, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map, roughness: 0.72 });
    add(new THREE.PlaneGeometry(...size), pos, mat, rotation);
  }
  function label(text: string, size: [number, number], pos: Point, color = '#d8e0e2', background = '#20272b') {
    const { map } = texture(1024, 128, (ctx) => {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = color;
      ctx.font = '500 62px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 32, 65);
    });
    panel(map, size, pos);
  }

  RectAreaLightUniformsLib.init();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.34;
  environment.dispose();
  pmrem.dispose();
  scene.background = new THREE.Color(0x363d41);
  scene.fog = new THREE.Fog(0x363d41, 19, 40);

  const floorTexture = texture(512, 512, (ctx) => {
    ctx.fillStyle = '#828789';
    ctx.fillRect(0, 0, 512, 512);
    let seed = 17;
    for (let i = 0; i < 42000; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % 512;
      seed = (seed * 16807) % 2147483647;
      ctx.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},0.045)`;
      ctx.fillRect(x, seed % 512, 2, 2);
    }
    ctx.strokeStyle = '#41474b';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 512, 512);
    ctx.strokeStyle = '#adb1b1';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, 504, 504);
    ctx.fillStyle = '#454c4e';
    for (const x of [10, 502]) for (const y of [10, 502]) ctx.fillRect(x - 1, y - 1, 3, 3);
  });
  floorTexture.map.wrapS = floorTexture.map.wrapT = THREE.RepeatWrapping;
  floorTexture.map.repeat.set(14, 18);
  const floor = new THREE.MeshStandardMaterial({ map: floorTexture.map, bumpMap: floorTexture.map, bumpScale: 0.014, roughness: 0.46, metalness: 0.2 });
  box([12, 0.12, 16], [0, -0.06, 0], floor);
  box([12, 3.8, 0.14], [0, 1.9, -7.6], wall);
  box([0.14, 3.8, 16], [-6, 1.9, 0], wall);
  box([0.14, 3.8, 16], [6, 1.9, 0], wall);
  box([12, 3.8, 0.14], [0, 1.9, 7.8], wall);
  box([12, 0.14, 16], [0, 3.8, 0], graphite);
  for (const x of [-5.88, 5.88]) {
    box([0.05, 0.17, 15.5], [x, 0.12, 0], graphite);
    for (let z = -7; z <= 7; z += 1.5) box([0.08, 3.55, 0.025], [x, 1.85, z], silver);
  }
  for (let x = -5.6; x < 6; x += 1.4) box([0.025, 3.7, 0.07], [x, 1.9, -7.49], silver);
  for (let z = -6.5; z < 8; z += 1.6) box([11.8, 0.08, 0.055], [0, 3.69, z], silver);
  for (const x of [-2.12, 2.12]) box([0.038, 0.007, 10.8], [x, 0.007, -1.1], yellow);

  scene.add(new THREE.HemisphereLight(0xddebf4, 0x716f64, 0.4));
  const sun = new THREE.DirectionalLight(0xfff1d8, 1.4);
  sun.position.set(-4, 6, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 28 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  for (const z of [-5, -1.1, 3]) {
    for (const x of [-1.45, 1.45]) {
      box([0.48, 0.09, 2.1], [x, 3.57, z], black, 0.025);
      box([0.38, 0.014, 1.96], [x, 3.514, z], lamp, 0.004);
    }
    const area = new THREE.RectAreaLight(0xe9f4ff, 4.2, 4, 2);
    area.position.set(0, 3.45, z);
    area.lookAt(0, 0, z);
    scene.add(area);
  }

  const wireColors = [0x238eb0, 0xd9b447, 0x2d9b85, 0x668dcb];
  const wireMats = wireColors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 }));
  for (const x of [-3.55, 3.55]) {
    for (const side of [-0.35, 0.35]) box([0.055, 0.14, 11], [x + side, 3.08, -1.2], silver);
    for (let z = -6.6; z < 4.4; z += 0.28) box([0.75, 0.025, 0.06], [x, 3.02, z], graphite);
    for (const z of [-5.5, -1.5, 2.5]) {
      for (const dx of [-0.28, 0.28]) box([0.014, 0.66, 0.014], [x + dx, 3.44, z], silver);
    }
    for (let i = 0; i < 9; i++) tube([[x - 0.25 + i * 0.055, 3.12, 4.2], [x - 0.25 + i * 0.055, 3.14, -1], [x - 0.25 + i * 0.055, 3.12, -6.5]], wireMats[i % 4], 0.018);
  }

  const ventMap = texture(128, 128, (ctx) => {
    ctx.fillStyle = '#252b2e'; ctx.fillRect(0, 0, 128, 128);
    for (let y = 4; y < 128; y += 8) for (let x = 4; x < 128; x += 8) {
      ctx.fillStyle = '#070a0d'; ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#454b4f'; ctx.fillRect(x - 1, y + 2, 2, 1);
    }
  }).map;
  const perforated = new THREE.MeshStandardMaterial({ map: ventMap, bumpMap: ventMap, bumpScale: 0.003, roughness: 0.56, metalness: 0.4 });

  function rack(x: number, z: number, name: string, index: number) {
    const front = z + 0.59;
    obstacle(x, z, 1.28, 1.2);
    box([1.25, 0.14, 1.2], [x, 0.12, z], graphite, 0.025);
    box([1.25, 0.09, 1.2], [x, 2.66, z], graphite, 0.015);
    box([1.14, 2.49, 0.06], [x, 1.36, z - 0.55], black);
    for (const dx of [-0.6, 0.6]) {
      box([0.06, 2.5, 1.14], [x + dx, 1.37, z], graphite, 0.008);
      box([0.06, 2.45, 0.065], [x + dx * 0.9, 1.36, front], silver);
      for (let y = 0.26; y < 2.58; y += 0.065) box([0.017, 0.022, 0.004], [x + dx * 0.9, y, front + 0.038], black);
    }
    label(name, [1.07, 0.12], [x, 2.54, front + 0.025]);
    for (let u = 0; u < 4; u++) {
      const y = 2.32 - u * 0.27;
      box([1.02, 0.16, 0.82], [x, y, z + 0.07], u === 2 ? silver : graphite, 0.009);
      for (let p = 0; p < 12; p++) {
        const px = x - 0.43 + p * 0.071;
        box([0.055, 0.06, 0.02], [px, y, front], silver);
        box([0.041, 0.042, 0.023], [px, y, front + 0.012], black);
        box([0.008, 0.009, 0.008], [px + 0.019, y + 0.043, front + 0.022], p % 5 === 0 ? amber : green);
        if (p < 8 && u === 0) {
          const endX = x - 0.43 + ((p + 3) % 12) * 0.071;
          tube([[px, y, front + 0.04], [px, y - 0.04, front + 0.16], [px + 0.07, y - 0.38 - p * 0.013, front + 0.23], [endX, y - 0.34, front + 0.12], [endX, y - 0.27, front + 0.04]], wireMats[(p + index) % 4], 0.009);
          box([0.032, 0.044, 0.07], [px, y, front + 0.05], wireMats[(p + index) % 4], 0.005);
        }
      }
    }
    for (let u = 0; u < 4; u++) {
      const y = 1.12 - u * 0.22;
      box([1.02, 0.19, 0.91], [x, y, z + 0.07], graphite, 0.008);
      box([0.9, 0.16, 0.015], [x, y, front + 0.006], perforated);
      for (let disk = 0; disk < 5; disk++) {
        const px = x - 0.35 + disk * 0.166;
        box([0.144, 0.135, 0.018], [px, y, front + 0.024], black, 0.003);
        box([0.113, 0.016, 0.021], [px, y - 0.038, front + 0.037], silver);
        box([0.006, 0.009, 0.008], [px - 0.052, y + 0.046, front + 0.038], green);
      }
    }
    for (const dx of [-0.48, 0.48]) {
      box([0.035, 0.2, 0.055], [x + dx, 0.49, front + 0.05], silver, 0.008);
    }
    for (let j = 0; j < 3; j++) tube([[x + 0.42 + j * 0.03, 2.32, front], [x + 0.68, 2.6, z + 0.4], [x + 0.43, 3.13, z], [x + 0.25, 3.13, z - 0.5]], wireMats[j], 0.014);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.027, 8, 6), index === 0 ? red : index === 1 ? amber : green);
    led.position.set(x + 0.46, 2.54, front + 0.04);
    pulseLights.push(led);
    scene.add(led);
  }
  rack(-3.55, -1.2, '01 / BRANCH ACCESS', 0);
  rack(3.55, -1.2, '02 / EDGE ROUTING', 1);
  rack(-3.55, -4.5, '03 / CORE SERVICES', 2);
  rack(3.55, -4.5, '04 / COMPUTE', 3);

  // The monitor graphics are real canvas textures, legible when approached.
  const dashboard = texture(1536, 768, () => {});
  function drawDashboard(health: Health, time: number) {
    const ctx = dashboard.ctx;
    ctx.fillStyle = '#07131c'; ctx.fillRect(0, 0, 1536, 768);
    ctx.fillStyle = '#9cb2bd'; ctx.font = '22px monospace'; ctx.fillText('NETWORK OPERATIONS / LIVE', 56, 60);
    ctx.fillStyle = '#e7f1f3'; ctx.font = '42px sans-serif'; ctx.fillText('Branch connectivity', 56, 123);
    ctx.fillStyle = health.endToEnd ? '#62dbb0' : '#edb861'; ctx.font = '23px monospace'; ctx.fillText(health.endToEnd ? 'ALL SYSTEMS OPERATIONAL' : 'INCIDENT NOC-1047 / ACTIVE', 56, 171);
    const xs = [140, 550, 960, 1390];
    const names = ['BRANCH PC', 'BR-SW1', 'BR-R1', 'HQ-R1'];
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = (i === 0 ? health.accessVlanOk : i === 1 ? health.branchLanAdvertised : true) ? '#4bad9d' : '#e6a75b';
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(xs[i] + 38, 313); ctx.lineTo(xs[i + 1] - 38, 313); ctx.stroke();
      const px = xs[i] + 45 + ((time * 0.18 + i * 0.3) % 1) * (xs[i + 1] - xs[i] - 90);
      ctx.fillStyle = '#c5f2e3'; ctx.fillRect(px, 307, 13, 13);
    }
    xs.forEach((x, i) => {
      ctx.fillStyle = '#203844'; ctx.fillRect(x - 37, 277, 74, 74);
      ctx.strokeStyle = '#9ab5c2'; ctx.lineWidth = 2; ctx.strokeRect(x - 29, 289, 58, 14); ctx.strokeRect(x - 29, 315, 58, 14);
      ctx.fillStyle = '#d3e4eb'; ctx.font = '21px monospace'; ctx.textAlign = 'center'; ctx.fillText(names[i], x, 397);
    });
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#29414d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(56, 459); ctx.lineTo(1480, 459); ctx.stroke();
    ['ACCESS VLAN', 'OSPF ADJACENCY', 'SERVICE PATH'].forEach((name, i) => {
      const x = 56 + i * 490;
      ctx.fillStyle = '#8cabb9'; ctx.font = '21px monospace'; ctx.fillText(name, x, 515);
      ctx.fillStyle = '#eef4f4'; ctx.font = '39px sans-serif'; ctx.fillText(i === 0 ? (health.accessVlanOk ? '20 / ONLINE' : '10 / MISMATCH') : i === 1 ? 'FULL' : health.endToEnd ? 'REACHABLE' : 'DEGRADED', x, 573);
      ctx.strokeStyle = i === 2 && !health.endToEnd ? '#daa45b' : '#52b8a4'; ctx.lineWidth = 2; ctx.beginPath();
      for (let j = 0; j < 70; j++) {
        const y = 664 - Math.abs(Math.sin(j * 0.43 + i * 2) * Math.sin(j * 1.73)) * 43;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x + j * 5.5, y);
      }
      ctx.stroke();
    });
    dashboard.map.needsUpdate = true;
  }
  drawDashboard({ accessVlanOk: false, branchLanAdvertised: false, endToEnd: false }, 0);
  label('NETWORK OPERATIONS', [3.75, 0.33], [0, 3.1, -7.5], '#343f44', '#b3b7b8');
  box([4.25, 2.15, 0.14], [0, 1.87, -7.4], black, 0.03);
  panel(dashboard.map, [4.07, 2.035], [0, 1.87, -7.32], true);

  const desktop = new THREE.MeshStandardMaterial({ color: 0x778185, metalness: 0.32, roughness: 0.42 });
  obstacle(0, -2.1, 2.6, 1.05);
  box([2.65, 0.1, 1.12], [0, 0.88, -2.1], desktop, 0.045);
  for (const x of [-1.05, 1.05]) {
    box([0.09, 0.77, 0.11], [x, 0.45, -2.26], silver, 0.015);
    box([0.55, 0.055, 0.7], [x, 0.045, -2.16], graphite, 0.018);
  }
  box([1.9, 0.09, 0.08], [0, 0.35, -2.35], silver, 0.009);
  for (const x of [-0.64, 0.64]) {
    box([1.2, 0.73, 0.08], [x, 1.47, -2.4], black, 0.025);
    box([0.05, 0.24, 0.08], [x, 1.02, -2.45], silver, 0.01);
    box([0.33, 0.022, 0.2], [x, 0.947, -2.41], graphite, 0.01);
  }
  panel(dashboard.map, [1.13, 0.645], [-0.64, 1.47, -2.353], true);
  const terminal = texture(1024, 576, (ctx) => {
    ctx.fillStyle = '#091319'; ctx.fillRect(0, 0, 1024, 576);
    ctx.fillStyle = '#8bcdb4'; ctx.font = '26px monospace';
    ['BR-R1# show ip interface brief', '', 'Interface     IP-Address      Status', 'Gi0/0         10.0.0.2        up', 'Gi0/1         192.168.20.1    up', '', 'BR-R1# show ip ospf neighbor', '1.1.1.1       FULL / DR', '', 'BR-R1# _'].forEach((line, i) => ctx.fillText(line, 35, 57 + i * 46));
  });
  panel(terminal.map, [1.13, 0.645], [0.64, 1.47, -2.353], true);
  box([0.69, 0.026, 0.24], [-0.26, 0.95, -1.8], graphite, 0.016);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 14; col++) box([0.039, 0.009, 0.039], [-0.56 + col * 0.046, 0.969, -1.884 + row * 0.05], black, 0.004);
  box([0.2, 0.008, 0.035], [-0.26, 0.97, -1.695], black, 0.006);
  box([0.09, 0.035, 0.135], [0.38, 0.96, -1.78], black, 0.022);
  tube([[0.39, 0.951, -1.87], [0.44, 0.948, -2.06], [0.63, 0.948, -2.24]], black, 0.004);
  label('01 / ENGINEERING', [0.58, 0.065], [-0.96, 0.872, -1.532]);

  // An offset chair leaves the console approach open.
  const chairX = 1.8;
  const chairZ = -0.25;
  obstacle(chairX, chairZ, 0.64, 0.68);
  box([0.57, 0.095, 0.55], [chairX, 0.51, chairZ], black, 0.04);
  box([0.53, 0.59, 0.075], [chairX, 0.88, chairZ + 0.24], perforated, 0.035, [0.12, 0, 0]);
  add(new THREE.CylinderGeometry(0.035, 0.045, 0.39, 12), [chairX, 0.27, chairZ], silver);
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    box([0.36, 0.035, 0.05], [chairX + Math.cos(angle) * 0.16, 0.08, chairZ + Math.sin(angle) * 0.16], graphite, 0.008, [0, -angle, 0]);
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.036, 12), [chairX + Math.cos(angle) * 0.32, 0.045, chairZ + Math.sin(angle) * 0.32], black, [Math.PI / 2, 0, angle]);
  }
  for (const dx of [-0.32, 0.32]) {
    box([0.025, 0.2, 0.04], [chairX + dx, 0.59, chairZ], silver, 0.008);
    box([0.06, 0.035, 0.28], [chairX + dx, 0.69, chairZ], black, 0.015);
  }

  // Rear utility cabinets and wall equipment give the room an occupied scale.
  for (const x of [-5, 5]) {
    obstacle(x, -6.95, 0.8, 0.7);
    box([0.8, 2.45, 0.65], [x, 1.25, -6.95], wall, 0.022);
    box([0.73, 1.84, 0.025], [x, 1.05, -6.607], graphite, 0.012);
    for (let y = 0.2; y < 1.95; y += 0.065) box([0.63, 0.02, 0.025], [x, y, -6.58], silver);
    label('COOLING / 21 C', [0.67, 0.085], [x, 2.32, -6.615]);
  }
  label('AUTHORIZED PERSONNEL', [1.8, 0.16], [0, 2.45, 7.69]);

  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = ![lamp, green, amber, red].includes(material as THREE.MeshStandardMaterial);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Geometry is static. Cache its shadow map; only the small status lights animate.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  let lastScreenFrame = -1;
  let lastHealth = '';
  return {
    consoleTarget: new THREE.Vector3(0, 0, -1.6),
    canStandAt(x: number, z: number) {
      return Math.abs(x) < 5.65 && z > -7.1 && z < 7.3 && !obstacles.some((o) => x > o.min.x && x < o.max.x && z > o.min.z && z < o.max.z);
    },
    update(health: Health, elapsed: number) {
      pulseLights[0].material = health.accessVlanOk ? green : red;
      pulseLights[1].material = health.branchLanAdvertised ? green : amber;
      pulseLights.forEach((light, i) => light.scale.setScalar(0.84 + Math.sin(elapsed * 3 + i) * 0.16));
      const key = `${health.accessVlanOk},${health.branchLanAdvertised},${health.endToEnd}`;
      if (Math.floor(elapsed * 6) !== lastScreenFrame || key !== lastHealth) {
        drawDashboard(health, elapsed);
        lastScreenFrame = Math.floor(elapsed * 6);
        lastHealth = key;
      }
    },
    dispose() {
      scene.environment = null;
      environmentTarget.dispose();
      scene.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      materials.forEach((material) => material.dispose());
      textures.forEach((map) => map.dispose());
      wireMats.forEach((mat) => mat.dispose());
      sun.shadow.dispose();
    },
  };
}
