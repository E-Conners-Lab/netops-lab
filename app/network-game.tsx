'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createNetworkRoom } from './room-scene';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Cable,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Command,
  Cpu,
  Crosshair,
  Eye,
  Keyboard,
  Map,
  Network,
  Play,
  RotateCcw,
  Server,
  Terminal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

import { deviceLabels, initialState, starterHistory, isRouter, routeHealth, promptFor, runCommand, commandHelp, completeCommand, configurationDiff } from './network-simulator';
import type { DeviceId, TerminalMode, SimState, TerminalEntry } from './network-simulator';

function mastery(state: SimState) {
  const health = routeHealth(state);
  return [
    {
      topic: 'Subnetting',
      value: 42 + (state.viewedSubnet ? 18 : 0) + (health.accessVlanOk ? 18 : 0) + (health.endToEnd ? 12 : 0),
    },
    {
      topic: 'Switching',
      value: 35 + (health.accessVlanOk ? 45 : 0) + Math.min(state.usedShowCommands * 2, 8),
    },
    {
      topic: 'Routing',
      value: 38 + (health.branchLanAdvertised ? 34 : 0) + (health.endToEnd ? 18 : 0),
    },
    {
      topic: 'OSPF',
      value: 32 + (health.branchLanAdvertised ? 46 : 0) + (health.endToEnd ? 12 : 0),
    },
    {
      topic: 'CLI fluency',
      value: Math.max(30, 48 + Math.min(state.usedShowCommands * 4, 24) - state.badCommands * 5),
    },
  ].map((item) => ({ ...item, value: Math.min(100, item.value) }));
}

function explainFix(state: SimState) {
  const health = routeHealth(state);
  if (health.endToEnd && state.verifiedBranchToHq) {
    return 'The branch workstation is now in VLAN 20, so it can reach 192.168.20.1. BR-R1 also advertises 192.168.20.0/24 in OSPF, so HQ-R1 has a return route. The ping succeeds because both forward and return paths exist.';
  }
  if (!health.accessVlanOk) {
    return `The PC address is valid for 192.168.20.0/24. Check Fa0/3: it is in VLAN ${state.branchAccessVlan} with ${state.portModes['FastEthernet0/3']} mode. The workstation needs an access port in VLAN 20.`;
  }
  if (!health.gatewayReachable) return 'Check the switch uplink and interface status. Fa0/1 needs access VLAN 20 to reach the untagged routed port on BR-R1, and the local interfaces must be up.';
  if (!health.ospfNeighborFull) return 'The WAN OSPF adjacency is down. Check interface status and matching OSPF area assignments on both routers.';
  if (!health.branchLanAdvertised) {
    return 'Layer 2 is fixed. The remaining issue is routing: HQ-R1 still lacks an OSPF route back to 192.168.20.0/24.';
  }
  if (!health.hqRoute) return 'The branch is reachable, but the HQ service network is not. Check HQ-R1 interface status and the OSPF advertisement for 10.10.10.0/24.';
  return 'The network state looks fixed. Verify it from the Branch PC with ping 10.10.10.10 to close the ticket.';
}

function NetworkRoom({
  consoleOpen,
  onOpenConsole,
  state,
}: {
  consoleOpen: boolean;
  onOpenConsole: () => void;
  state: SimState;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef({ consoleOpen, state });
  const touchKeysRef = useRef(new Set<string>());
  const touchPulseRef = useRef<Record<string, number>>({ a: 0, d: 0, s: 0, w: 0 });
  const [nearConsole, setNearConsole] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);

  useEffect(() => {
    statusRef.current = { consoleOpen, state };
    if (consoleOpen) touchKeysRef.current.clear();
  }, [consoleOpen, state]);

  const setTouchKey = useCallback((key: string, active: boolean) => {
    if (active) touchKeysRef.current.add(key);
    else touchKeysRef.current.delete(key);
  }, []);

  const pulseTouchKey = useCallback((key: string) => {
    touchPulseRef.current[key] = 0.38;
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.08, 50);
    const narrowView = mount.clientWidth < 700;
    camera.position.set(narrowView ? -4.65 : 0, 1.68, 4.4);
    camera.rotation.order = 'YXZ';

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mount.clientWidth < 700 ? 1.25 : 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.appendChild(renderer.domElement);
    const room = createNetworkRoom(scene, renderer);
    const consoleTarget = room.consoleTarget;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const ambientOcclusion = new SSAOPass(scene, camera, mount.clientWidth, mount.clientHeight, 12);
    ambientOcclusion.kernelRadius = 1.5;
    ambientOcclusion.minDistance = 0.001;
    ambientOcclusion.maxDistance = 0.035;
    ambientOcclusion.enabled = mount.clientWidth >= 800;
    composer.addPass(ambientOcclusion);
    const output = new OutputPass();
    composer.addPass(output);
    const keys = new Set<string>();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let yaw = narrowView ? -0.45 : 0;
    let pitch = -0.035;
    let frameId = 0;
    let touchLook: { id: number; x: number; y: number } | null = null;

    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      ambientOcclusion.enabled = width >= 800;
    };

    const onPointerLockChange = () => {
      setPointerLocked(document.pointerLockElement === renderer.domElement);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement || statusRef.current.consoleOpen) return;
      yaw -= event.movementX * 0.0022;
      pitch -= event.movementY * 0.0022;
      pitch = Math.max(-1.12, Math.min(1.12, pitch));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (statusRef.current.consoleOpen) return;
      keys.add(event.key.toLowerCase());
      const flatDistance = Math.hypot(camera.position.x - consoleTarget.x, camera.position.z - consoleTarget.z);
      if (event.key.toLowerCase() === 'e' && flatDistance < 2.35) onOpenConsole();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.key.toLowerCase());
    };

    const clearMovement = () => {
      keys.clear();
      touchKeysRef.current.clear();
      touchLook = null;
    };

    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || statusRef.current.consoleOpen) return;
      touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onTouchMove = (event: PointerEvent) => {
      if (!touchLook || event.pointerId !== touchLook.id || statusRef.current.consoleOpen) return;
      yaw -= (event.clientX - touchLook.x) * 0.004;
      pitch = THREE.MathUtils.clamp(pitch - (event.clientY - touchLook.y) * 0.004, -1.12, 1.12);
      touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onTouchEnd = () => { touchLook = null; };

    const onCanvasClick = (event: PointerEvent) => {
      if (!statusRef.current.consoleOpen && event.pointerType !== 'touch') {
        renderer.domElement.requestPointerLock?.()?.catch(() => undefined);
      }
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('blur', clearMovement);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('pointerdown', onTouchStart);
    renderer.domElement.addEventListener('pointermove', onTouchMove);
    renderer.domElement.addEventListener('pointerup', onTouchEnd);
    renderer.domElement.addEventListener('pointercancel', onTouchEnd);

    let lastFrame = performance.now();

    const animate = () => {
      const now = performance.now();
      const elapsed = now / 1000;
      const delta = Math.min((now - lastFrame) / 1000, 0.035);
      lastFrame = now;
      const activeState = statusRef.current.state;
      const health = routeHealth(activeState);

      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(yAxis, yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(yAxis, yaw);
      const touchActive = (key: string) => {
        const pulse = touchPulseRef.current[key] ?? 0;
        if (pulse > 0) {
          touchPulseRef.current[key] = Math.max(0, pulse - delta);
          return true;
        }
        return touchKeysRef.current.has(key);
      };

      const canMove = !statusRef.current.consoleOpen;
      const move = new THREE.Vector3();
      if (canMove && (keys.has('w') || touchActive('w'))) move.add(forward);
      if (canMove && (keys.has('s') || touchActive('s'))) move.sub(forward);
      if (canMove && (keys.has('d') || touchActive('d'))) move.add(right);
      if (canMove && (keys.has('a') || touchActive('a'))) move.sub(right);
      if (canMove && move.lengthSq() > 0) {
        move.normalize();
        const speed = keys.has('shift') ? 5.2 : 3.1;
        const nextX = camera.position.x + move.x * speed * delta;
        const nextZ = camera.position.z + move.z * speed * delta;
        if (room.canStandAt(nextX, camera.position.z)) camera.position.x = nextX;
        if (room.canStandAt(camera.position.x, nextZ)) camera.position.z = nextZ;
      }
      camera.position.y = 1.68;
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      mount.dataset.camera = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
      mount.dataset.ready = 'true';

      const flatDistance = Math.hypot(camera.position.x - consoleTarget.x, camera.position.z - consoleTarget.z);
      setNearConsole(flatDistance < 2.35);

      room.update(health, elapsed);
      composer.render();
      frameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', clearMovement);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('click', onCanvasClick);
      renderer.domElement.removeEventListener('pointerdown', onTouchStart);
      renderer.domElement.removeEventListener('pointermove', onTouchMove);
      renderer.domElement.removeEventListener('pointerup', onTouchEnd);
      renderer.domElement.removeEventListener('pointercancel', onTouchEnd);
      room.dispose();
      ambientOcclusion.dispose();
      output.dispose();
      composer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [onOpenConsole]);

  return (
    <section className="room-stage" aria-label="Explorable 3D network operations room">
      <div ref={mountRef} className="room-canvas" />

      <div className="hud-top">
        <div className="hud-brand">
          <Network aria-hidden="true" />
          <div>
            <p>NetOps Lab</p>
            <span>Mission NOC-1047</span>
          </div>
        </div>
        <div className="hud-pill">
          <Crosshair aria-hidden="true" />
          <span>{pointerLocked ? 'Mouse look active' : 'Click scene for mouse look'}</span>
        </div>
      </div>

      <div className="hud-bottom">
        <div className="movement-hint">
          <Keyboard aria-hidden="true" />
          <span>WASD move</span>
          <span>Shift jog</span>
          <span>Mouse look</span>
          <span>E at console</span>
        </div>
        <Button className="console-button" size="lg" onClick={onOpenConsole}>
          <Terminal aria-hidden="true" />
          Open Console
        </Button>
      </div>

      <div className="touch-controls" aria-label="Movement controls">
        {[
          ['w', 'Move forward', <ArrowUp key="icon" aria-hidden="true" />],
          ['a', 'Move left', <ArrowLeft key="icon" aria-hidden="true" />],
          ['s', 'Move backward', <ArrowDown key="icon" aria-hidden="true" />],
          ['d', 'Move right', <ArrowRight key="icon" aria-hidden="true" />],
        ].map(([key, label, icon]) => (
          <button
            key={key as string}
            type="button"
            aria-label={label as string}
            onClick={() => pulseTouchKey(key as string)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setTouchKey(key as string, true);
            }}
            onPointerUp={() => setTouchKey(key as string, false)}
            onPointerCancel={() => setTouchKey(key as string, false)}
            onPointerLeave={() => setTouchKey(key as string, false)}
          >
            {icon}
          </button>
        ))}
      </div>

      {nearConsole && !consoleOpen ? (
        <div className="proximity-prompt" aria-live="polite">
          <Command aria-hidden="true" />
          <span>Press E to access the topology console</span>
        </div>
      ) : null}
    </section>
  );
}

function TopologyView({ state }: { state: SimState }) {
  const health = routeHealth(state);
  const links = [
    {
      from: [14, 74],
      to: [34, 42],
      ok: health.gatewayReachable,
      label: 'Fa0/3 VLAN 20',
    },
    {
      from: [34, 42],
      to: [54, 42],
      ok: health.gatewayReachable,
      label: 'Branch LAN',
    },
    {
      from: [54, 42],
      to: [76, 42],
      ok: health.ospfNeighborFull,
      label: 'OSPF WAN',
    },
    {
      from: [76, 42],
      to: [90, 74],
      ok: health.hqReturnRoute,
      label: 'Return route',
    },
  ];

  return (
    <div className="topology-panel">
      <div className="panel-heading">
        <Map aria-hidden="true" />
        <div>
          <h2>Live Topology</h2>
          <p>Routes and links reflect the simulated device state.</p>
        </div>
      </div>

      <div className="topology-map" aria-label="Branch to HQ topology">
        {links.map((link) => (
          <div
            key={link.label}
            className={`topology-link ${link.ok ? 'link-ok' : 'link-bad'}`}
            style={{
              left: `${Math.min(link.from[0], link.to[0])}%`,
              top: `${Math.min(link.from[1], link.to[1])}%`,
              width: `${Math.hypot(link.to[0] - link.from[0], link.to[1] - link.from[1])}%`,
              transform: `rotate(${Math.atan2(link.to[1] - link.from[1], link.to[0] - link.from[0])}rad)`,
            }}
          >
            <span>{link.label}</span>
          </div>
        ))}

        <TopologyNode
          icon={<Cpu aria-hidden="true" />}
          label="Branch PC"
          detail="192.168.20.45/24"
          x={14}
          y={74}
          ok={health.gatewayReachable}
        />
        <TopologyNode
          icon={<Cable aria-hidden="true" />}
          label="BR-SW1"
          detail={`Fa0/3 VLAN ${state.branchAccessVlan}`}
          x={34}
          y={42}
          ok={health.accessVlanOk}
        />
        <TopologyNode
          icon={<Network aria-hidden="true" />}
          label="BR-R1"
          detail="192.168.20.1 / 10.0.0.2"
          x={54}
          y={42}
          ok={health.branchLanAdvertised}
        />
        <TopologyNode
          icon={<Network aria-hidden="true" />}
          label="HQ-R1"
          detail={health.hqReturnRoute ? 'Has branch route' : 'Missing branch route'}
          x={76}
          y={42}
          ok={health.hqReturnRoute}
        />
        <TopologyNode
          icon={<Server aria-hidden="true" />}
          label="HQ Server"
          detail="10.10.10.10"
          x={90}
          y={74}
          ok={health.endToEnd}
        />
      </div>
    </div>
  );
}

function TopologyNode({
  icon,
  label,
  detail,
  x,
  y,
  ok,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  x: number;
  y: number;
  ok: boolean;
}) {
  return (
    <div className={`topology-node ${ok ? 'node-ok' : 'node-bad'}`} style={{ left: `${x}%`, top: `${y}%` }}>
      <div className="node-icon">{icon}</div>
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}

function SubnetPanel({
  state,
  onViewed,
}: {
  state: SimState;
  onViewed: () => void;
}) {
  useEffect(() => {
    onViewed();
  }, [onViewed]);

  const octets = [
    { label: 'Network', value: '192.168.20.0', role: 'reserved' },
    { label: 'Gateway', value: '192.168.20.1', role: 'usable' },
    { label: 'Branch PC', value: '192.168.20.45', role: 'usable' },
    { label: 'Last Host', value: '192.168.20.254', role: 'usable' },
    { label: 'Broadcast', value: '192.168.20.255', role: 'reserved' },
  ];

  return (
    <div className="subnet-panel">
      <div className="panel-heading">
        <Eye aria-hidden="true" />
        <div>
          <h2>Subnet Lens</h2>
          <p>Branch users were assigned 192.168.20.0/24.</p>
        </div>
      </div>

      <div className="subnet-strip" aria-label="Visual subnet range for 192.168.20.0/24">
        {octets.map((item) => (
          <div key={item.label} className={`subnet-block ${item.role}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="binary-row" aria-label="Binary breakdown of the final IPv4 octet">
        <span>Final octet for /24 host space</span>
        <code>00000000</code>
        <ChevronRight aria-hidden="true" />
        <code>11111111</code>
      </div>

      <p className="subnet-note">
        {routeHealth(state).gatewayReachable
          ? 'The PC and its gateway share the VLAN 20 broadcast domain. Traffic to other subnets can now reach the router.'
          : `The PC address is valid. Check Fa0/3 (VLAN ${state.branchAccessVlan}), the uplink VLAN, and interface status to reach 192.168.20.1.`}
      </p>
    </div>
  );
}


type TerminalSession = {
  mode: TerminalMode;
  currentInterface: string | null;
  command: string;
  history: TerminalEntry[];
  recalled: number | null;
  draft: string;
};
type Sessions = Record<DeviceId, TerminalSession>;
function newSessions(): Sessions {
  return Object.fromEntries(Object.keys(deviceLabels).map((id) => [id, { mode: 'exec', currentInterface: null, command: '', history: [...starterHistory], recalled: null, draft: '' }])) as Sessions;
}

function TerminalPanel({ activeDevice, setActiveDevice, state, setState, sessions, setSessions }: {
  activeDevice: DeviceId;
  setActiveDevice: (device: DeviceId) => void;
  state: SimState;
  setState: Dispatch<SetStateAction<SimState>>;
  sessions: Sessions;
  setSessions: Dispatch<SetStateAction<Sessions>>;
}) {
  const session = sessions[activeDevice];
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prompt = promptFor(activeDevice, session.mode);
  const patchSession = (patch: Partial<TerminalSession>) => setSessions((current) => ({ ...current, [activeDevice]: { ...current[activeDevice], ...patch } }));

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [activeDevice]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session.history]);

  const execute = (lines: string[], remainder = '') => {
    let nextState = state;
    const nextSession = { ...session };
    for (const line of lines) {
      const command = line.trim();
      if (!command) continue;
      if (activeDevice === 'branch-pc' && command === 'clear') { nextSession.history = []; continue; }
      const result = runCommand(activeDevice, command, nextState, nextSession.mode, nextSession.currentInterface);
      nextSession.history = [...nextSession.history, { prompt: promptFor(activeDevice, nextSession.mode), command, output: result.output, status: result.status ?? 'ok' }];
      nextState = result.state ?? nextState;
      if (result.nextMode) nextSession.mode = result.nextMode;
      if ('nextInterface' in result) nextSession.currentInterface = result.nextInterface ?? null;
    }
    setState(nextState);
    setSessions((current) => ({ ...current, [activeDevice]: { ...nextSession, command: remainder, recalled: null, draft: '' } }));
    inputRef.current?.focus({ preventScroll: true });
  };

  const recall = (direction: -1 | 1) => {
    const commands = session.history.filter((entry) => entry.prompt.startsWith(deviceLabels[activeDevice]) || entry.prompt === 'branch-pc$').filter((entry) => !entry.command.endsWith('?')).map((entry) => entry.command);
    const index = Math.max(0, Math.min(commands.length, (session.recalled ?? commands.length) + direction));
    const draft = session.recalled === null ? session.command : session.draft;
    patchSession({ command: commands[index] ?? draft, recalled: index === commands.length ? null : index, draft });
  };

  return (
    <div className="terminal-panel">
      <div className="device-bar" aria-label="Console device selector">
        {(Object.keys(deviceLabels) as DeviceId[]).map((device) => (
          <Button key={device} type="button" variant={activeDevice === device ? 'default' : 'secondary'} size="sm" aria-pressed={activeDevice === device} onClick={() => { setActiveDevice(device); inputRef.current?.focus({ preventScroll: true }); }}>
            {isRouter(device) ? <Network aria-hidden="true" /> : device === 'br-sw1' ? <Cable aria-hidden="true" /> : <Cpu aria-hidden="true" />}
            {deviceLabels[device]}
          </Button>
        ))}
      </div>
      <div className="terminal-output" ref={scrollRef} role="log" aria-label="Device terminal output" aria-live="polite">
        {session.history.map((item, index) => (
          <div key={`${item.prompt}-${index}`} className={`terminal-entry ${item.status}`}>
            <div className="terminal-command"><span>{item.prompt}</span><strong>{item.command}</strong></div>
            {item.output ? <pre>{item.output}</pre> : null}
          </div>
        ))}
      </div>
      <form className="terminal-form" onSubmit={(event) => { event.preventDefault(); execute([session.command]); }}>
        <label htmlFor="terminal-command">{prompt}</label>
        <input id="terminal-command" ref={inputRef} value={session.command} spellCheck={false} autoComplete="off" autoCapitalize="none" autoCorrect="off" enterKeyHint="send"
          onChange={(event) => patchSession({ command: event.target.value, recalled: null })}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\r\n?/g, '\n');
            if (!pasted.includes('\n')) return;
            event.preventDefault();
            const input = event.currentTarget;
            const text = session.command.slice(0, input.selectionStart ?? 0) + pasted + session.command.slice(input.selectionEnd ?? session.command.length);
            const lines = text.split('\n');
            const remainder = lines.pop() ?? '';
            execute(lines, remainder);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowUp' || (event.ctrlKey && event.key.toLowerCase() === 'p')) { event.preventDefault(); recall(-1); }
            else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key.toLowerCase() === 'n')) { event.preventDefault(); recall(1); }
            else if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); patchSession({ command: completeCommand(activeDevice, session.mode, session.command) }); }
            else if (event.key === '?' && activeDevice !== 'branch-pc') {
              event.preventDefault();
              patchSession({ history: [...session.history, { prompt, command: session.command + '?', output: commandHelp(activeDevice, session.mode, session.command + '?'), status: 'info' }] });
            } else if (event.ctrlKey && event.key.toLowerCase() === 'z') {
              event.preventDefault(); patchSession({ mode: activeDevice !== 'branch-pc' ? 'exec' : session.mode, currentInterface: null, command: '' });
            } else if (event.ctrlKey && event.key.toLowerCase() === 'c') {
              if (window.getSelection()?.toString()) return;
              event.preventDefault(); patchSession({ command: '', mode: session.mode === 'user-exec' ? 'user-exec' : 'exec', currentInterface: null });
            } else if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); patchSession({ history: [] }); }
          }} placeholder="Type a command" />
        <Button type="submit" size="icon-lg" aria-label="Run command"><Play aria-hidden="true" /></Button>
      </form>
    </div>
  );
}

function MissionPanel({ state, onReset }: { state: SimState; onReset: () => void }) {
  const health = routeHealth(state);
  const objectiveItems = [
    { text: 'Inspect BR-SW1 access VLAN', done: state.usedShowCommands > 0 || health.accessVlanOk },
    { text: 'Place Fa0/3 in VLAN 20', done: health.accessVlanOk },
    { text: 'Advertise 192.168.20.0/24 in OSPF', done: health.branchLanAdvertised },
    { text: 'Verify Branch PC to 10.10.10.10', done: state.verifiedBranchToHq },
  ];

  return (
    <aside className="mission-panel">
      <div className="ticket-heading">
        <div>
          <span className="eyebrow">Active Ticket</span>
          <h1>Bring the Branch Office Online</h1>
        </div>
        <Button variant="secondary" size="icon" onClick={onReset} aria-label="Reset mission">
          <RotateCcw aria-hidden="true" />
        </Button>
      </div>

      <p className="ticket-copy">
        Branch users cannot reach the HQ intranet. Diagnose the path, fix the switching and routing faults,
        then prove the service is reachable from the Branch PC.
      </p>

      <div className="objective-list">
        {objectiveItems.map((item) => (
          <div key={item.text} className={`objective ${item.done ? 'done' : ''}`}>
            {item.done ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
            <span>{item.text}</span>
          </div>
        ))}
      </div>

      <div className="mentor-box">
        <CircleHelp aria-hidden="true" />
        <p>{explainFix(state)}</p>
      </div>
    </aside>
  );
}

function DiffPanel({ state }: { state: SimState }) {
  return (
    <div className="diff-panel">
      <div className="panel-heading">
        <Command aria-hidden="true" />
        <div>
          <h2>Running Diff</h2>
          <p>Changes from the initial device configuration.</p>
        </div>
      </div>

      <pre className="diff-output">
        {configurationDiff(state)}
      </pre>
    </div>
  );
}

function MasteryPanel({ state }: { state: SimState }) {
  const values = mastery(state);
  const lowest = values.reduce((weak, item) => (item.value < weak.value ? item : weak), values[0]);
  const complete = routeHealth(state).endToEnd && state.verifiedBranchToHq;

  return (
    <div className="mastery-panel">
      <div className="panel-heading">
        <Terminal aria-hidden="true" />
        <div>
          <h2>Mastery</h2>
          <p>{complete ? 'Ticket closed. Recommended next drill is based on the weakest score.' : 'Scores update as you inspect, change, and verify.'}</p>
        </div>
      </div>

      <div className="mastery-list">
        {values.map((item) => (
          <div key={item.topic} className="mastery-row">
            <div>
              <span>{item.topic}</span>
              <strong>{item.value}%</strong>
            </div>
            <Progress value={item.value} />
          </div>
        ))}
      </div>

      <div className="practice-callout">
        <span>Suggested practice</span>
        <strong>{lowest.topic} reinforcement lab</strong>
      </div>
    </div>
  );
}

function ConsoleOverlay({
  open,
  onClose,
  state,
  setState,
}: {
  open: boolean;
  onClose: () => void;
  state: SimState;
  setState: Dispatch<SetStateAction<SimState>>;
}) {
  const [activeDevice, setActiveDevice] = useState<DeviceId>('branch-pc');
  const [sessions, setSessions] = useState<Sessions>(newSessions);
  const handleViewedSubnet = useCallback(() => {
    setState((current) => (current.viewedSubnet ? current : { ...current, viewedSubnet: true }));
  }, [setState]);

  if (!open) return null;

  return (
    <dialog open className="console-overlay" aria-label="Topology simulator console">
      <div className="console-shell">
        <header className="console-header">
          <div>
            <span className="eyebrow">Topology Console</span>
            <h2>Branch to HQ Recovery Lab</h2>
          </div>
          <Button variant="secondary" onClick={onClose}>
            Return to Room
          </Button>
        </header>

        <div className="console-grid">
          <div className="console-left">
            <MissionPanel
              state={state}
              onReset={() => {
                setState(initialState);
                setActiveDevice('branch-pc');
                setSessions(newSessions());
              }}
            />
            <SubnetPanel state={state} onViewed={handleViewedSubnet} />
          </div>

          <div className="console-center">
            <TopologyView state={state} />
            <TerminalPanel
              activeDevice={activeDevice}
              setActiveDevice={setActiveDevice}
              state={state}
              setState={setState}
              sessions={sessions}
              setSessions={setSessions}
            />
          </div>

          <div className="console-right">
            <DiffPanel state={state} />
            <MasteryPanel state={state} />
          </div>
        </div>
      </div>
    </dialog>
  );
}

export default function NetworkGame() {
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [state, setState] = useState<SimState>(initialState);
  const health = useMemo(() => routeHealth(state), [state]);
  const openConsole = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock();
    setConsoleOpen(true);
  }, []);

  return (
    <main className="game-root">
      <NetworkRoom consoleOpen={consoleOpen} onOpenConsole={openConsole} state={state} />
      <div className="status-rail" aria-label="Mission status">
        <div className={`rail-item ${health.accessVlanOk ? 'ok' : 'bad'}`}>
          <Cable aria-hidden="true" />
          <span>Switching</span>
        </div>
        <div className={`rail-item ${health.branchLanAdvertised ? 'ok' : 'bad'}`}>
          <Network aria-hidden="true" />
          <span>OSPF</span>
        </div>
        <div className={`rail-item ${health.endToEnd ? 'ok' : 'bad'}`}>
          <Server aria-hidden="true" />
          <span>Reachability</span>
        </div>
      </div>
      <ConsoleOverlay open={consoleOpen} onClose={() => setConsoleOpen(false)} state={state} setState={setState} />
    </main>
  );
}
