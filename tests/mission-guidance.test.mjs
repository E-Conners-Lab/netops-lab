import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, runCommand, routeHealth } from '../app/network-simulator.ts';
import { missionGuidance, guidanceCommands } from '../app/mission-guidance.ts';

function lab() {
  let state = structuredClone(initialState);
  const sessions = {};
  return {
    send(device, ...commands) {
      const session = sessions[device] ??= { mode: 'exec', iface: null };
      for (const command of commands) {
        const result = runCommand(device, command, state, session.mode, session.iface);
        state = result.state ?? state;
        session.mode = result.nextMode ?? session.mode;
        if ('nextInterface' in result) session.iface = result.nextInterface;
      }
    },
    get state() { return state; },
    get guide() { return missionGuidance(state, routeHealth(state)); },
  };
}

test('guide advances through evidence, repair, local verification, and end-to-end verification', () => {
  const game = lab();
  assert.equal(game.guide.id, 'address');
  game.send('branch-pc', 'ip a');
  assert.equal(game.guide.id, 'address');
  game.send('branch-pc', 'ip route');
  assert.equal(game.guide.id, 'inspect-access');
  game.send('br-sw1', 'sh vl br');
  assert.equal(game.guide.id, 'fix-access');
  game.send('br-sw1', ...game.guide.commands);
  assert.equal(game.guide.id, 'gateway');
  game.send('branch-pc', ...game.guide.commands);
  assert.equal(game.guide.id, 'inspect-route');
  game.send('hq-r1', 'sh ip ro');
  assert.equal(game.guide.id, 'advertise');
  game.send('br-r1', ...game.guide.commands);
  assert.equal(game.guide.id, 'verify');
  game.send('br-r1', 'ping 10.10.10.10');
  assert.equal(game.guide.id, 'verify');
  game.send('branch-pc', 'ping 10.10.10.10');
  assert.equal(game.guide.id, 'complete');
});

test('observations require relevant commands on the correct devices', () => {
  const game = lab();
  game.send('br-r1', 'sh ver', 'sh ip ro');
  game.send('br-sw1', 'sh ip int br', 'sh int f0/1 sw', 'sh banana');
  assert.deepEqual(game.state.observations, []);
  game.send('br-sw1', 'conf t', 'do sh int f0/3 sw');
  game.send('hq-r1', 'sh ip ro ospf');
  assert.deepEqual(game.state.observations, ['access-vlan', 'return-route']);
});

test('failed gateway pings do not count, and breaking the local path invalidates verification', () => {
  const game = lab();
  game.send('branch-pc', 'ip addr', 'ip route', 'ping 192.168.20.1');
  assert.equal(game.state.observations.includes('gateway-test'), false);
  game.send('br-sw1', 'conf t', 'int f0/3', 'sw acc vl 20');
  game.send('branch-pc', 'ping 192.168.20.1');
  assert.equal(game.state.observations.includes('gateway-test'), true);
  game.send('br-sw1', 'shut');
  assert.equal(game.state.observations.includes('gateway-test'), false);
  assert.equal(game.guide.id, 'shutdown-br-sw1:FastEthernet0/3');
  game.send('br-sw1', ...guidanceCommands(game.guide, 'interface'));
  assert.equal(game.guide.id, 'gateway');
});

test('command references work from user, exec, and configuration modes', () => {
  const state = { ...structuredClone(initialState), observations: ['pc-address', 'pc-route', 'access-vlan'] };
  const guide = missionGuidance(state, routeHealth(state));
  for (const mode of ['user-exec', 'exec', 'config', 'interface', 'router-ospf']) {
    let current = mode;
    let next = state;
    let iface = null;
    for (const command of guidanceCommands(guide, current)) {
      const result = runCommand(guide.device, command, next, current, iface);
      assert.notEqual(result.status, 'error', `${mode}: ${command}`);
      current = result.nextMode ?? current;
      next = result.state ?? next;
      if ('nextInterface' in result) iface = result.nextInterface;
    }
    assert.equal(routeHealth(next).accessVlanOk, true);
  }
  const inspection = missionGuidance({ ...state, observations: ['pc-address', 'pc-route'] }, routeHealth(state));
  assert.ok(guidanceCommands(inspection, 'interface').every((command) => command.startsWith('do show')));
});

test('a player may solve the mission out of order without guidance blocking completion', () => {
  const game = lab();
  game.send('br-sw1', 'conf t', 'int f0/3', 'sw acc vl 20');
  game.send('br-r1', 'conf t', 'router ospf 1', 'net 192.168.20.1 0.0.0.0 a 0');
  game.send('branch-pc', 'ping 10.10.10.10');
  assert.equal(game.guide.id, 'complete');
  game.send('br-r1', 'int g0/0', 'shut');
  assert.notEqual(game.guide.id, 'complete');
});
