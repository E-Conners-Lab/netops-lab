import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, runCommand, routeHealth, promptFor, commandHelp, completeCommand, configurationDiff, topologyLinks } from '../app/network-simulator.ts';

function consoleFor(device, state = structuredClone(initialState)) {
  let mode = 'exec';
  let iface = null;
  return {
    send(command) {
      const result = runCommand(device, command, state, mode, iface);
      state = result.state ?? state;
      mode = result.nextMode ?? mode;
      if ('nextInterface' in result) iface = result.nextInterface;
      return result;
    },
    get state() { return state; },
    get mode() { return mode; },
    get iface() { return iface; },
    get prompt() { return promptFor(device, mode); },
  };
}

test('unique abbreviations work token by token, including case and whitespace', () => {
  for (const device of ['br-sw1', 'br-r1', 'hq-r1']) {
    for (const command of ['sh ip int br', 'show ip int bri', 'SHOW IP INTERFACE B', ' sh   ip    int brief ']) {
      assert.match(consoleFor(device).send(command).output, /IP-Address/);
    }
  }
  const cli = consoleFor('br-sw1');
  for (const command of ['en', 'conf te', 'int f 0/3', 'sw mod acc', 'sw acc vl 20']) assert.notEqual(cli.send(command).status, 'error', command);
  assert.equal(cli.state.branchAccessVlan, 20);
  assert.equal(cli.prompt, 'BR-SW1(config-if)#');
});

test('privilege levels and config exits obey their modes', () => {
  const cli = consoleFor('br-r1');
  cli.send('dis');
  assert.equal(cli.prompt, 'BR-R1>');
  assert.equal(cli.send('conf t').status, 'error');
  assert.equal(cli.send('sh run').status, 'error');
  cli.send('en'); cli.send('conf t'); cli.send('router ospf 1');
  assert.equal(cli.prompt, 'BR-R1(config-router)#');
  cli.send('ex'); assert.equal(cli.mode, 'config');
  cli.send('ex'); assert.equal(cli.mode, 'exec');
});

test('do show preserves interface context and returns live values', () => {
  const cli = consoleFor('br-sw1');
  cli.send('conf t'); cli.send('int fa0/3'); cli.send('sw acc vlan 20');
  assert.match(cli.send('do sh int f0/3 sw').output, /Access Mode VLAN: 20/);
  assert.equal(cli.mode, 'interface');
  assert.equal(cli.iface, 'FastEthernet0/3');
  cli.send('end'); assert.equal(cli.iface, null);
});

test('ambiguous, incomplete and invalid commands have distinct errors and no config mutations', () => {
  const cli = consoleFor('br-sw1');
  assert.match(cli.send('c').output, /Ambiguous command/);
  assert.match(cli.send('conf').output, /Incomplete command/);
  assert.match(cli.send('sh ip banana').output, /Invalid input/);
  cli.send('conf t'); cli.send('int fa0/3');
  for (const command of ['sw acc vlan 0', 'sw acc vlan 4095', 'sw acc vlan 1.5', 'sw acc vlan 20 trailing', 'int fa0/99']) assert.equal(cli.send(command).status, 'error');
  assert.equal(cli.state.branchAccessVlan, 10);
  assert.equal(cli.iface, 'FastEthernet0/3');
});

test('valid but incorrect VLANs apply as real configuration', () => {
  const cli = consoleFor('br-sw1');
  cli.send('conf t'); cli.send('int fa0/3');
  assert.notEqual(cli.send('sw acc vlan 30').status, 'error');
  assert.equal(cli.state.branchAccessVlan, 30);
  assert.equal(routeHealth(cli.state).gatewayReachable, false);
  assert.match(cli.send('do sh vlan bri').output, /30\s+VLAN0030\s+active\s+Fa0\/3/);
  cli.send('no sw acc vlan'); assert.equal(cli.state.branchAccessVlan, 1);
});

test('OSPF accepts equivalent host wildcard statements, removals and mismatching statements', () => {
  const cli = consoleFor('br-r1'); cli.send('conf t'); cli.send('rout ospf 1');
  assert.notEqual(cli.send('net 172.16.1.0 0.0.0.255 a 0').status, 'error');
  assert.equal(routeHealth(cli.state).hqReturnRoute, false);
  cli.send('net 192.168.20.1 0.0.0.0 area 0.0.0.0');
  assert.equal(routeHealth(cli.state).hqReturnRoute, true);
  assert.match(consoleFor('hq-r1', cli.state).send('sh ip ro ospf').output, /192.168.20.0\/24/);
  cli.send('no net 192.168.20.1 0.0.0.0 a 0');
  assert.equal(routeHealth(cli.state).hqReturnRoute, false);
  assert.equal(cli.send('net 999.1.1.1 0.0.0.255 a 0').status, 'error');
});

test('shutdown, no shutdown and OSPF area mismatch affect reachability', () => {
  const cli = consoleFor('br-r1'); cli.send('conf t'); cli.send('int gi 0/0'); cli.send('shut');
  assert.equal(routeHealth(cli.state).ospfNeighborFull, false);
  assert.match(cli.send('do sh ip int br').output, /administratively down/);
  assert.doesNotMatch(cli.send('do sh ip route').output, /^C\s+10.0.0.0\/30/m);
  cli.send('no sh'); assert.equal(routeHealth(cli.state).ospfNeighborFull, true);
  cli.send('router ospf 1'); cli.send('no net 10.0.0.0 0.0.0.3 a 0'); cli.send('net 10.0.0.0 0.0.0.3 a 1');
  assert.equal(routeHealth(cli.state).ospfNeighborFull, false);
});

test('startup configuration is a snapshot and saves accept IOS abbreviations', () => {
  const cli = consoleFor('br-sw1'); cli.send('conf t'); cli.send('int fa0/3'); cli.send('sw acc vlan 20'); cli.send('end');
  assert.match(cli.send('wr mem').output, /\[OK\]/);
  cli.send('conf t'); cli.send('int fa0/3'); cli.send('sw acc vlan 30');
  assert.match(cli.send('do sh start').output, /switchport access vlan 20/);
  assert.match(cli.send('do sh run int fa0/3').output, /switchport access vlan 30/);
  cli.send('end'); assert.match(cli.send('copy run start').output, /\[OK\]/);
  assert.match(cli.send('sh start').output, /switchport access vlan 30/);
});

test('help and tab completion follow the current mode without executing commands', () => {
  assert.match(commandHelp('br-r1', 'exec', 'sh ip ?'), /route/);
  assert.doesNotMatch(commandHelp('br-sw1', 'interface', '?'), /router/);
  assert.match(commandHelp('br-sw1', 'interface', 'sw acc vlan ?'), /<vlan>/);
  assert.equal(completeCommand('br-r1', 'exec', 'sh ip int bri'), 'show ip interface brief ');
  assert.equal(completeCommand('br-r1', 'exec', 'c'), 'c');
  const cli = consoleFor('br-r1'); cli.send('conf t?'); assert.equal(cli.mode, 'exec');
});

test('show output filters work and descriptions retain case', () => {
  const cli = consoleFor('br-sw1'); cli.send('conf t'); cli.send('int fa0/3');
  cli.send('desc Branch Workstation');
  assert.equal(cli.send('do sh run int fa0/3 | i description').output, ' description Branch Workstation');
  assert.doesNotMatch(cli.send('do sh run | ex switchport').output, /switchport/);
  assert.match(cli.send('do sh run | b interface FastEthernet0/3').output, /^interface FastEthernet0\/3/);
});

test('mission completes through abbreviations and loses verification if broken again', () => {
  const sw = consoleFor('br-sw1'); sw.send('conf t'); sw.send('int f0/3'); sw.send('sw acc vl 20');
  const br = consoleFor('br-r1', sw.state); br.send('conf t'); br.send('rou ospf 1'); br.send('net 192.168.20.0 0.0.0.255 ar 0');
  const pc = consoleFor('branch-pc', br.state);
  assert.match(pc.send('ping 10.10.10.10').output, /3 packets transmitted, 3 received/);
  assert.equal(pc.state.verifiedBranchToHq, true);
  const again = consoleFor('br-sw1', pc.state); again.send('conf t'); again.send('int fa0/3'); again.send('shut');
  assert.equal(again.state.verifiedBranchToHq, false);
  assert.equal(routeHealth(again.state).endToEnd, false);
});

test('HQ cannot ping a branch host stranded in the wrong VLAN', () => {
  const br = consoleFor('br-r1'); br.send('conf t'); br.send('router ospf 1'); br.send('net 192.168.20.0 0.0.0.255 a 0');
  assert.equal(consoleFor('hq-r1', br.state).send('ping 192.168.20.45').status, 'error');
  assert.match(consoleFor('hq-r1', br.state).send('sh ip ospf nei').output, /2.2.2.2/);
});

test('running diff includes mistakes and clears after restoring the original configuration', () => {
  const cli = consoleFor('br-sw1'); cli.send('conf t'); cli.send('int fa0/3'); cli.send('sw acc vlan 30'); cli.send('shut');
  assert.match(configurationDiff(cli.state), /\+ switchport access vlan 30/);
  assert.match(configurationDiff(cli.state), /\+ shutdown/);
  cli.send('sw acc vlan 10'); cli.send('no shut');
  assert.equal(configurationDiff(cli.state), '# No configuration changes');
});

test('topology separates the access fault from the missing return route', () => {
  assert.deepEqual(topologyLinks(initialState).map((link) => [link.id, link.status]), [['access','blocked'], ['uplink','up'], ['wan','up'], ['server','up']]);
  const cli = consoleFor('br-sw1'); cli.send('conf t'); cli.send('int fa0/3'); cli.send('sw acc vl 20');
  assert.ok(topologyLinks(cli.state).every((link) => link.status === 'up'));
  assert.equal(routeHealth(cli.state).hqReturnRoute, false);
  assert.equal(routeHealth(cli.state).endToEnd, false);
});

test('each interface shutdown marks the correct physical topology link', () => {
  for (const [iface, expected] of [
    ['br-sw1:FastEthernet0/3', 'access'],
    ['br-sw1:FastEthernet0/1', 'uplink'],
    ['br-r1:GigabitEthernet0/1', 'uplink'],
    ['br-r1:GigabitEthernet0/0', 'wan'],
    ['hq-r1:GigabitEthernet0/0', 'wan'],
    ['hq-r1:GigabitEthernet0/1', 'server'],
  ]) {
    const links = topologyLinks({ ...initialState, shutdownInterfaces: [iface] });
    assert.deepEqual(links.filter((link) => link.status === 'down').map((link) => link.id), [expected], iface);
  }
});

test('a lost OSPF adjacency is distinct from a shut WAN link', () => {
  const links = topologyLinks({ ...initialState, brOspfNetworks: [] });
  const wan = links.find((link) => link.id === 'wan');
  assert.equal(wan.status, 'blocked');
  assert.equal(wan.detail, 'Link up; no OSPF adjacency');
  assert.equal(links.find((link) => link.id === 'server').status, 'up');
});
