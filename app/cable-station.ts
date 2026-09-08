import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CablePort, SimState } from './network-simulator';

export type StationPort = CablePort | 'FastEthernet0/1';
export const stationPorts: {
  id: StationPort;
  label: string;
  x: number;
  purpose: string;
}[] = [
  {
    id: 'console',
    label: 'Console',
    x: -0.38,
    purpose: 'Serial management / no Ethernet',
  },
  {
    id: 'FastEthernet0/1',
    label: 'Fa0/1',
    x: -0.12,
    purpose: 'Router uplink / occupied',
  },
  {
    id: 'FastEthernet0/2',
    label: 'Fa0/2',
    x: 0.12,
    purpose: 'Spare access port',
  },
  {
    id: 'FastEthernet0/3',
    label: 'Fa0/3',
    x: 0.36,
    purpose: 'Desk B-03 / assigned port',
  },
];

export function createCableStation() {
  const group = new THREE.Group();
  const materials = new Set<THREE.Material>();
  const textures: THREE.Texture[] = [];
  const metal = new THREE.MeshStandardMaterial({
    color: 0x8e9c9d,
    metalness: 0.68,
    roughness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1f292d,
    metalness: 0.35,
    roughness: 0.46,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x080e11,
    roughness: 0.7,
  });
  const blue = new THREE.MeshStandardMaterial({
    color: 0x279ccc,
    roughness: 0.42,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xcba34d,
    metalness: 0.7,
    roughness: 0.35,
  });
  const green = new THREE.MeshBasicMaterial({ color: 0x85e9ac });
  const off = new THREE.MeshBasicMaterial({ color: 0x29342f });
  const highlight = new THREE.MeshBasicMaterial({ color: 0xe2c976 });
  [metal, dark, black, blue, gold, green, off, highlight].forEach((mat) =>
    materials.add(mat),
  );
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = dark,
  ) =>
    add(
      new RoundedBoxGeometry(w, h, d, 1, Math.min(0.005, h / 4)),
      mat,
      x,
      y,
      z,
    );
  const label = (
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    color = '#e0e7e6',
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((w / h) * 128);
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1f292d';
    ctx.fillRect(0, 0, canvas.width, 128);
    ctx.fillStyle = color;
    ctx.font = '600 86px monospace';
    const fontSize = Math.min(
      86,
      (86 * (canvas.width - 32)) / ctx.measureText(text).width,
    );
    ctx.font = `600 ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, 64);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    textures.push(map);
    const material = new THREE.MeshBasicMaterial({ map });
    materials.add(material);
    add(new THREE.PlaneGeometry(w, h), material, x, y, 0.162);
  };
  box(1.09, 0.94, 0.15, 0, 0.08, -0.1, black);
  box(1.04, 0.2, 0.3, 0, 0, 0, metal);
  box(1.04, 0.17, 0.27, 0, 0.41, 0, dark);
  label('BR-SW1 / ACCESS SWITCH', 0, -0.072, 0.48, 0.032);
  label('PP-03 / DESK B-03', 0.02, 0.457, 0.62, 0.04);
  label('PATCH SCHEDULE', -0.19, 0.245, 0.52, 0.04, '#e5cc7e');
  label('PP-03 > Fa0/3', -0.19, 0.185, 0.52, 0.045, '#e5cc7e');
  const sourceX = 0.16;
  box(0.11, 0.074, 0.025, sourceX, 0.382, 0.143, metal);
  box(0.089, 0.052, 0.027, sourceX, 0.382, 0.16, black);
  for (const x of [-0.49, 0.49])
    for (const y of [-0.065, 0.065, 0.36, 0.46])
      add(
        new THREE.CylinderGeometry(0.009, 0.009, 0.006, 12).rotateX(
          Math.PI / 2,
        ),
        metal,
        x,
        y,
        0.157,
      );
  const hitTargets: THREE.Mesh[] = [];
  const leds: Record<string, THREE.Mesh> = {};
  const outlines: Record<string, THREE.Mesh> = {};
  stationPorts.forEach((port) => {
    outlines[port.id] = box(
      0.15,
      0.1,
      0.012,
      port.x,
      0.014,
      0.153,
      port.id === 'console' ? blue : metal,
    );
    const jack = box(0.108, 0.07, 0.02, port.x, 0.014, 0.17, black);
    jack.userData.port = port.id;
    hitTargets.push(jack);
    for (let pin = 0; pin < 8; pin++)
      box(0.007, 0.012, 0.008, port.x - 0.035 + pin * 0.01, 0.039, 0.185, gold);
    label(
      port.label,
      port.x,
      0.077,
      0.16,
      0.026,
      port.id === 'console' ? '#7ac7e9' : '#e0e7e6',
    );
    leds[port.id] = box(0.013, 0.01, 0.01, port.x + 0.066, -0.016, 0.169, off);
  });
  const cable = new THREE.Mesh(new THREE.BufferGeometry(), blue);
  group.add(cable);
  const plug = box(0.082, 0.054, 0.09, 0, 0, 0, blue);
  const boot = box(0.047, 0.03, 0.09, 0, 0, 0, blue);
  box(0.082, 0.054, 0.09, sourceX, 0.382, 0.207, blue);
  const uplinkMat = new THREE.MeshStandardMaterial({
    color: 0xd4bc65,
    roughness: 0.48,
  });
  materials.add(uplinkMat);
  const uplinkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.12, 0.014, 0.21),
    new THREE.Vector3(-0.12, -0.2, 0.27),
    new THREE.Vector3(-0.48, -0.29, 0.3),
    new THREE.Vector3(-0.57, 0.2, 0.04),
  ]);
  add(
    new THREE.TubeGeometry(uplinkCurve, 30, 0.014, 8, false),
    uplinkMat,
    0,
    0,
    0,
  );
  box(0.082, 0.054, 0.09, -0.12, 0.014, 0.207, uplinkMat);
  let previous: CablePort | null | undefined;
  return {
    group,
    pick(ray: THREE.Raycaster): StationPort | null {
      return (
        ray.intersectObjects(hitTargets, false)[0]?.object.userData.port ?? null
      );
    },
    intersects(ray: THREE.Raycaster) {
      return ray.intersectObject(group, true).length > 0;
    },
    update(state: SimState, selected: StationPort | null = null) {
      for (const port of stationPorts) {
        outlines[port.id].material =
          selected === port.id
            ? highlight
            : port.id === 'console'
              ? blue
              : metal;
        const on =
          port.id === 'FastEthernet0/1'
            ? !state.shutdownInterfaces.includes('br-r1:GigabitEthernet0/1') &&
              !state.shutdownInterfaces.includes('br-sw1:FastEthernet0/1')
            : port.id !== 'console' &&
              state.cablePort === port.id &&
              !state.shutdownInterfaces.includes(`br-sw1:${port.id}`);
        leds[port.id].material = on ? green : off;
      }
      if (previous === state.cablePort) return;
      previous = state.cablePort;
      const end =
        state.cablePort === null
          ? new THREE.Vector3(0.33, -0.24, 0.36)
          : new THREE.Vector3(
              stationPorts.find((p) => p.id === state.cablePort)!.x,
              0.014,
              0.22,
            );
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sourceX, 0.382, 0.23),
        new THREE.Vector3(sourceX, 0.25, 0.36),
        new THREE.Vector3(0.54, 0.22, 0.38),
        new THREE.Vector3(0.53, -0.17, 0.4),
        new THREE.Vector3(end.x + 0.04, end.y - 0.13, 0.4),
        end,
      ]);
      cable.geometry.dispose();
      cable.geometry = new THREE.TubeGeometry(curve, 48, 0.013, 10, false);
      plug.position.copy(end);
      boot.position.copy(end).add(new THREE.Vector3(0, 0, 0.07));
    },
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      group.removeFromParent();
    },
  };
}
