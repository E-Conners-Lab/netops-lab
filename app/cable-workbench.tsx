'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ArrowLeft,
  Cable,
  Check,
  CircleAlert,
  Plug,
  Unplug,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createCableStation, stationPorts } from './cable-station';
import type { StationPort } from './cable-station';
import {
  interfaceUp,
  missionComplete,
  missions,
  patchCable,
  routeHealth,
} from './network-simulator';
import type { SimState } from './network-simulator';

export function CableWorkbench({
  state,
  onState,
  onClose,
  onConsole,
}: {
  state: SimState;
  onState: (state: SimState) => void;
  onClose: () => void;
  onConsole: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<StationPort>('console');
  const [message, setMessage] = useState(
    'Desk B-03 terminates at PP-03. Its assigned Ethernet port is Fa0/3.',
  );
  const current = useRef({ state, selected });
  useEffect(() => {
    current.current = { state, selected };
  }, [state, selected]);
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x151f24);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe8f5ff, 0x4f5550, 2.5));
    const key = new THREE.DirectionalLight(0xfff0db, 3);
    key.position.set(-2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc1e4f0, 1.5);
    fill.position.set(3, 0.2, 2);
    scene.add(fill);
    const station = createCableStation();
    scene.add(station.group);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 3.2;
    controls.minPolarAngle = 1.1;
    controls.maxPolarAngle = 1.85;
    controls.minAzimuthAngle = -0.5;
    controls.maxAzimuthAngle = 0.5;
    controls.target.set(0, 0.12, 0);
    const fit = () => {
      const w = mount.clientWidth,
        h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      const distance = Math.max(
        1.9,
        1.4 /
          (2 *
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
            camera.aspect),
      );
      camera.position.set(0.1, 0.28, Math.min(3.2, distance));
      camera.updateProjectionMatrix();
      controls.update();
    };
    fit();
    window.addEventListener('resize', fit);
    const ray = new THREE.Raycaster();
    let pointer = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const port = station.pick(ray);
      if (port) setSelected(port);
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', up);
    let frame = 0;
    const draw = () => {
      station.update(current.current.state, current.current.selected);
      controls.update();
      renderer.render(scene, camera);
      mount.dataset.ready = 'true';
      mount.dataset.cable = current.current.state.cablePort ?? 'disconnected';
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      controls.dispose();
      station.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  const connect = (port: StationPort | null) => {
    const result = patchCable(state, port);
    setMessage(result.output);
    if (result.state) onState(result.state);
  };
  const port = stationPorts.find((p) => p.id === selected)!;
  const health = routeHealth(state);
  return (
    <section className="cable-workbench" aria-label="3D switch inspection">
      <header className="workbench-header">
        <Button variant="secondary" onClick={onClose}>
          <ArrowLeft />
          Room
        </Button>
        <div>
          <span className="eyebrow">
            {missions[state.missionId].ticket} / Rack 01
          </span>
          <h1>BR-SW1 patch bay</h1>
        </div>
        <Button onClick={onConsole}>
          <Terminal />
          Console
        </Button>
      </header>
      <div className="workbench-scene" ref={mountRef} />
      <aside className="patch-tools">
        <div className="patch-lead">
          <Cable />
          <div>
            <span>PP-03 / Desk B-03</span>
            <strong>
              {state.cablePort?.replace('FastEthernet', 'Fa') ?? 'Disconnected'}
            </strong>
          </div>
          <span className={health.carrier ? 'carrier-on' : 'carrier-off'}>
            {health.carrier ? 'LINK UP' : 'NO CARRIER'}
          </span>
        </div>
        <fieldset className="port-picker">
          <legend>Inspect port</legend>
          {stationPorts.map((p) => (
            <label key={p.id}>
              <input
                type="radio"
                name="port"
                value={p.id}
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
              />
              <span>{p.label}</span>
              <i
                className={
                  p.id !== 'console' && interfaceUp('br-sw1', p.id, state)
                    ? 'port-lit'
                    : ''
                }
              />
            </label>
          ))}
        </fieldset>
        <div className="port-details">
          <h2>{port.label}</h2>
          <p>{port.purpose}</p>
          {selected !== 'console' ? (
            <span>
              Access VLAN {state.portVlans[selected]} /{' '}
              {interfaceUp('br-sw1', selected, state) ? 'link up' : 'link down'}
            </span>
          ) : (
            <span>RJ-45 connector / asynchronous serial</span>
          )}
        </div>
        <div className="patch-actions">
          <Button
            variant="secondary"
            disabled={state.cablePort === null}
            onClick={() => connect(null)}
          >
            <Unplug />
            Unplug PP-03
          </Button>
          <Button
            disabled={state.cablePort !== null}
            onClick={() => connect(selected)}
          >
            <Plug />
            Connect to {port.label}
          </Button>
        </div>
        <output className="patch-feedback">
          <CircleAlert />
          {message}
        </output>
        {state.cablePort === 'FastEthernet0/3' ? (
          <div className="patch-next">
            <Check />
            <p>
              {missionComplete(state)
                ? 'Ticket closed. Physical path and end-to-end connectivity verified.'
                : health.endToEnd
                  ? 'Patch matches the schedule. Verify with ping 10.10.10.10 from the Branch PC.'
                  : 'Patch matches the schedule. A remaining configuration fault still blocks reachability; inspect the console.'}
            </p>
          </div>
        ) : null}
      </aside>
    </section>
  );
}
