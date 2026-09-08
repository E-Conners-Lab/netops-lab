import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialMissionState,
  initialState,
  patchCable,
  routeHealth,
  runCommand,
  missionComplete,
  topologyLinks,
  configurationDiff,
  interfaceUp,
} from '../app/network-simulator.ts';
import { missionGuidance } from '../app/mission-guidance.ts';
import {
  newMissionProgress,
  validProgress,
  checkpoint,
} from '../app/lab-progress.ts';

const lab = () => ({
  version: 1,
  activeMission: 'branch',
  missions: {
    branch: newMissionProgress(initialMissionState('branch')),
    cabling: newMissionProgress(initialMissionState('cabling')),
  },
});
const command = (state, device, input) =>
  runCommand(device, input, state, 'exec', null);
const move = (state, port) =>
  patchCable(patchCable(state, null).state, port).state;

test('cabling starts with one physical fault, isolated from the original mission', () => {
  const state = initialMissionState('cabling');
  assert.equal(state.cablePort, 'console');
  const health = routeHealth(state);
  assert.equal(health.carrier, false);
  assert.equal(health.accessVlanOk, true);
  assert.equal(health.hqReturnRoute, true);
  assert.equal(health.ospfNeighborFull, true);
  assert.equal(health.endToEnd, false);
  state.portVlans['FastEthernet0/3'] = 123;
  assert.equal(initialState.branchAccessVlan, 10);
  assert.equal(initialMissionState('cabling').portVlans['FastEthernet0/3'], 20);
});

test('physical connection governs IOS, Linux and topology carrier consistently', () => {
  let state = initialMissionState('cabling');
  assert.match(
    command(state, 'branch-pc', 'ip addr').output,
    /NO-CARRIER.*state DOWN/,
  );
  assert.match(
    command(state, 'br-sw1', 'sh int status').output,
    /Fa0\/3\s+.*notconnect/,
  );
  assert.equal(topologyLinks(state)[0].status, 'down');
  assert.equal(patchCable(state, 'FastEthernet0/3').status, 'error');
  state = patchCable(state, null).state;
  assert.equal(patchCable(state, 'FastEthernet0/1').status, 'error');
  assert.equal(patchCable(state, 'bogus').status, 'error');
  state = patchCable(state, 'FastEthernet0/2').state;
  assert.equal(routeHealth(state).carrier, true);
  assert.equal(routeHealth(state).endToEnd, false);
  assert.equal(topologyLinks(state)[0].status, 'blocked');
  state = move(state, 'FastEthernet0/3');
  assert.equal(routeHealth(state).endToEnd, true);
  assert.match(
    command(state, 'branch-pc', 'ip addr').output,
    /LOWER_UP.*state UP/,
  );
  assert.match(
    command(state, 'br-sw1', 'sh int status').output,
    /Fa0\/3\s+.*connected/,
  );
  assert.equal(interfaceUp('br-sw1', 'FastEthernet0/2', state), false);
  assert.equal(topologyLinks(state)[0].status, 'up');
  assert.match(configurationDiff(state), /PP-03/);
});

test('cabling completion requires inspection, assigned port, and a fresh workstation verification', () => {
  let state = move(initialMissionState('cabling'), 'FastEthernet0/3');
  assert.equal(missionComplete(state), false);
  state = command(state, 'branch-pc', 'ping 10.10.10.10').state;
  assert.equal(missionComplete(state), false);
  state.observations.push('physical-port');
  assert.equal(missionComplete(state), true);
  state = patchCable(state, null).state;
  assert.equal(missionComplete(state), false);
  assert.equal(state.verifiedBranchToHq, false);
  state = patchCable(state, 'FastEthernet0/2').state;
  state.portVlans['FastEthernet0/2'] = 20;
  state = command(state, 'branch-pc', 'ping 10.10.10.10').state;
  assert.equal(routeHealth(state).endToEnd, true);
  assert.equal(missionComplete(state), false);
  assert.equal(missionGuidance(state, routeHealth(state)).id, 'physical-patch');
});

test('physical guide advances and recovers from subsequent interface shutdown', () => {
  let state = initialMissionState('cabling');
  assert.equal(
    missionGuidance(state, routeHealth(state)).id,
    'physical-inspect',
  );
  state.observations.push('physical-port');
  assert.equal(missionGuidance(state, routeHealth(state)).id, 'physical-patch');
  state = move(state, 'FastEthernet0/3');
  assert.equal(
    missionGuidance(state, routeHealth(state)).id,
    'physical-verify',
  );
  state.shutdownInterfaces.push('br-sw1:FastEthernet0/3');
  assert.equal(routeHealth(state).carrier, false);
  assert.equal(missionGuidance(state, routeHealth(state)).total, 4);
});

test('checkpoints retain independent mission configs, CLI modes, hints, and cable position', () => {
  const progress = lab();
  progress.activeMission = 'cabling';
  const current = progress.missions.cabling;
  current.state = move(current.state, 'FastEthernet0/3');
  current.hints['physical-patch'] = 1;
  current.activeDevice = 'br-sw1';
  current.sessions['br-sw1'].mode = 'interface';
  current.sessions['br-sw1'].currentInterface = 'FastEthernet0/3';
  const restored = JSON.parse(JSON.stringify(checkpoint(progress)));
  assert.equal(validProgress(restored), true);
  assert.equal(restored.missions.cabling.sessions['br-sw1'].mode, 'interface');
  assert.equal(restored.missions.cabling.hints['physical-patch'], 1);
  assert.equal(restored.missions.branch.state.branchAccessVlan, 10);
  assert.equal(restored.missions.cabling.state.cablePort, 'FastEthernet0/3');
  restored.missions.cabling = newMissionProgress(
    initialMissionState('cabling'),
  );
  assert.equal(restored.missions.branch.state.branchAccessVlan, 10);
});

test('checkpoint history is bounded without mutating the live session', () => {
  const progress = lab();
  const session = progress.missions.branch.sessions['br-sw1'];
  session.history = Array.from({ length: 80 }, (_, i) => ({
    prompt: 'BR-SW1#',
    command: `show ${i}`,
    output: 'x'.repeat(7000),
    status: 'ok',
  }));
  session.recalled = 70;
  const saved = checkpoint(progress);
  assert.equal(validProgress(saved), true);
  assert.equal(saved.missions.branch.sessions['br-sw1'].history.length, 40);
  assert.equal(
    saved.missions.branch.sessions['br-sw1'].history[0].output.length,
    6000,
  );
  assert.equal(session.history.length, 80);
  assert.equal(session.recalled, 70);
});

test('invalid or future saves are rejected rather than replacing live state', () => {
  for (const mutate of [
    (p) => (p.version = 2),
    (p) => (p.missions.cabling.state.cablePort = 'FastEthernet0/1'),
    (p) => (p.missions.branch.state.portVlans['FastEthernet0/3'] = 999),
    (p) => (p.missions.branch.sessions['branch-pc'].mode = 'interface'),
    (p) => (p.missions.cabling.state.brOspfNetworks = ['not an address']),
    (p) => (p.missions.branch.hints['bad key'] = 2),
    (p) => (p.missions.cabling.state.cablePort = ['console']),
  ]) {
    const progress = lab();
    mutate(progress);
    assert.equal(validProgress(progress), false);
  }
  for (const value of [null, [], {}, 'hello'])
    assert.equal(validProgress(value), false);
});
