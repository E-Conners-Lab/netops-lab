export type DeviceId = 'branch-pc' | 'br-sw1' | 'br-r1' | 'hq-r1';
export type TerminalMode = 'user-exec' | 'exec' | 'config' | 'interface' | 'router-ospf';
export type MissionId = 'branch' | 'cabling';
export type CablePort = 'console' | 'FastEthernet0/2' | 'FastEthernet0/3';
export type Observation = 'pc-address' | 'pc-route' | 'access-vlan' | 'gateway-test' | 'return-route' | 'physical-port';

export const missions = {
  branch: { ticket: 'NOC-1047', title: 'Bring the Branch Online', summary: 'Restore the access VLAN and OSPF return route, then verify connectivity from the branch workstation.', topics: 'VLANs / OSPF / Troubleshooting' },
  cabling: { ticket: 'NOC-1048', title: 'The Misplaced Patch Lead', summary: 'Desk B-03 lost Ethernet after a rack tidy-up. Trace its patch lead from PP-03 to the assigned switch port, Fa0/3, then verify HQ reachability.', topics: 'Physical layer / Port identification / Verification' },
};

export type SimState = {
  missionId: MissionId;
  cablePort: CablePort | null;
  branchAccessVlan: number;
  brOspfNetworks: string[];
  hqOspfNetworks: string[];
  shutdownInterfaces: string[];
  portModes: Record<string, 'access' | 'trunk'>;
  portVlans: Record<string, number>;
  descriptions: Record<string, string>;
  startupConfigs: Partial<Record<DeviceId, string>>;
  verifiedBranchToHq: boolean;
  viewedSubnet: boolean;
  usedShowCommands: number;
  badCommands: number;
  observations: Observation[];
};

export type TerminalEntry = {
  prompt: string;
  command: string;
  output: string;
  status: 'ok' | 'error' | 'info';
};

export type CommandResult = {
  output: string;
  status?: TerminalEntry['status'];
  nextMode?: TerminalMode;
  nextInterface?: string | null;
  state?: SimState;
};

export const deviceLabels: Record<DeviceId, string> = {
  'branch-pc': 'Branch PC',
  'br-sw1': 'BR-SW1',
  'br-r1': 'BR-R1',
  'hq-r1': 'HQ-R1',
};

export const deviceKinds: Record<DeviceId, string> = {
  'branch-pc': 'Linux client',
  'br-sw1': 'Catalyst access switch',
  'br-r1': 'Cisco branch router',
  'hq-r1': 'Cisco HQ router',
};

export const initialState: SimState = {
  missionId: 'branch',
  cablePort: 'FastEthernet0/3',
  branchAccessVlan: 10,
  brOspfNetworks: ['10.0.0.0 0.0.0.3 area 0'],
  hqOspfNetworks: ['10.0.0.0 0.0.0.3 area 0', '10.10.10.0 0.0.0.255 area 0'],
  shutdownInterfaces: [],
  portModes: { 'FastEthernet0/1': 'access', 'FastEthernet0/2': 'access', 'FastEthernet0/3': 'access' },
  portVlans: { 'FastEthernet0/1': 20, 'FastEthernet0/2': 10, 'FastEthernet0/3': 10 },
  descriptions: {},
  startupConfigs: {},
  verifiedBranchToHq: false,
  viewedSubnet: false,
  usedShowCommands: 0,
  badCommands: 0,
  observations: [],
};

export function initialMissionState(id: MissionId): SimState {
  const state = structuredClone(initialState);
  if (id === 'cabling') {
    state.missionId = id;
    state.cablePort = 'console';
    state.branchAccessVlan = state.portVlans['FastEthernet0/3'] = 20;
    state.brOspfNetworks.push('192.168.20.0 0.0.0.255 area 0');
  }
  return state;
}

export function missionComplete(state: SimState) {
  return state.verifiedBranchToHq && routeHealth(state).endToEnd && (state.missionId === 'branch' || (state.cablePort === 'FastEthernet0/3' && state.observations.includes('physical-port')));
}

export function patchCable(state: SimState, port: CablePort | 'FastEthernet0/1' | null): CommandResult {
  if (port === 'FastEthernet0/1') return { output: 'Fa0/1 is occupied by the router uplink. Leave that circuit in service.', status: 'error' };
  if (port !== null && !['console', 'FastEthernet0/2', 'FastEthernet0/3'].includes(port)) return { output: 'Unknown port.', status: 'error' };
  if (state.cablePort === port) return { output: 'The cable is already in that position.', status: 'info' };
  if (state.cablePort !== null && port !== null) return { output: 'Disconnect the patch lead before moving it to another port.', status: 'error' };
  return { state: { ...state, cablePort: port, verifiedBranchToHq: false, observations: state.observations.filter((item) => item !== 'gateway-test') }, output: port === null ? 'PP-03 patch lead disconnected.' : port === 'console' ? 'Connected to Console. This is a serial management port, not Ethernet; the workstation has no carrier.' : `PP-03 connected to ${port.replace('FastEthernet', 'Fa')}. Verify the link from the workstation.`, status: 'info' };
}

export function interfaceUp(device: DeviceId, iface: string, state: SimState): boolean {
  if (state.shutdownInterfaces.includes(`${device}:${iface}`)) return false;
  if (device === 'branch-pc') return state.cablePort !== null && state.cablePort !== 'console' && interfaceUp('br-sw1', state.cablePort, state);
  if (device === 'br-sw1' && iface !== 'FastEthernet0/1') return state.cablePort === iface;
  if (device === 'br-sw1') return !state.shutdownInterfaces.includes('br-r1:GigabitEthernet0/1');
  if (device === 'br-r1' && iface === 'GigabitEthernet0/1') return !state.shutdownInterfaces.includes('br-sw1:FastEthernet0/1');
  if (iface === 'GigabitEthernet0/0') return !state.shutdownInterfaces.includes(`${device === 'br-r1' ? 'hq-r1' : 'br-r1'}:GigabitEthernet0/0`);
  return true;
}

function observe(state: SimState, observation: Observation): SimState {
  return { ...state, observations: [...new Set([...state.observations, observation])] };
}

export const starterHistory: TerminalEntry[] = [
  {
    prompt: 'mentor',
    command: 'ticket accepted',
    output:
      'Ticket NOC-1047: Branch users cannot reach the HQ intranet at 10.10.10.10. Use the room console, inspect the topology, fix the network, then verify from the Branch PC.',
    status: 'info',
  },
  {
    prompt: 'mentor',
    command: 'first moves',
    output:
      'Try show commands first. Good starting points: show vlan brief on BR-SW1, show ip route on BR-R1 or HQ-R1, and ping 10.10.10.10 from the Branch PC.',
    status: 'info',
  },
];

export function normalizeCommand(command: string) {
  return command.trim().toLowerCase().replace(/\s+/g, ' ');
}

const interfaces: Record<DeviceId, string[]> = {
  'branch-pc': ['eth0'],
  'br-sw1': ['FastEthernet0/1', 'FastEthernet0/2', 'FastEthernet0/3'],
  'br-r1': ['GigabitEthernet0/0', 'GigabitEthernet0/1'],
  'hq-r1': ['GigabitEthernet0/0', 'GigabitEthernet0/1'],
};

function ipv4Number(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((ip, part) => ip * 256 + Number(part), 0) >>> 0;
}

function ospfAreas(networks: string[], address: string) {
  const ip = ipv4Number(address)!;
  return networks.filter((line) => {
    const [network, wildcard] = line.split(' ');
    const mask = ~ipv4Number(wildcard)!;
    return (ip & mask) === (ipv4Number(network)! & mask);
  }).map((line) => line.split(' ')[3]);
}

function advertised(networks: string[], address: string) {
  return ospfAreas(networks, address).length > 0;
}

function canonicalInterface(device: DeviceId, value: string) {
  const match = /^([a-z]+)(\d+\/\d+)$/i.exec(value.replace(/\s/g, ''));
  if (!match) return null;
  return interfaces[device].find((name) => name.toLowerCase().startsWith(match[1].toLowerCase()) && name.endsWith(match[2])) ?? null;
}

type GrammarEntry = { path: string[]; action: string };
function grammar(device: DeviceId, mode: TerminalMode): GrammarEntry[] {
  const entries: GrammarEntry[] = [];
  const add = (path: string, action = path) => entries.push({ path: path.split(' '), action });
  add('help'); add('exit');
  if (mode === 'exec' || mode === 'user-exec') {
    add('enable'); add('disable');
    add('show ip interface'); add('show ip interface brief'); add('show ip interface <interface>');
    add('show interfaces'); add('show interfaces <interface>');
    add('show version'); add('show cdp neighbors');
    add('terminal length <length>');
    add('ping <address>'); add('traceroute <address>');
    if (device === 'br-sw1') {
      add('show vlan'); add('show vlan brief');
      add('show interfaces status'); add('show interfaces trunk');
      add('show interfaces <interface> switchport');
    } else {
      add('show ip route'); add('show ip route ospf'); add('show ip route connected');
      add('show ip ospf neighbor'); add('show ip protocols');
    }
    if (mode === 'exec') {
      add('show running-config'); add('show running-config interface <interface>');
      add('show startup-config'); add('configure terminal');
      add('write', 'save'); add('write memory', 'save'); add('copy running-config startup-config', 'save');
    }
  } else {
    add('end');
    add('interface <interface>');
    if (device !== 'br-sw1') add('router ospf <process>');
    if (mode === 'interface') {
      add('shutdown'); add('no shutdown'); add('description <text>'); add('no description');
      if (device === 'br-sw1') {
        add('switchport mode access'); add('switchport mode trunk');
        add('switchport access vlan <vlan>'); add('no switchport access vlan');
      }
    }
    if (mode === 'router-ospf') {
      add('network <address> <wildcard> area <area>');
      add('no network <address> <wildcard> area <area>');
    }
    for (const entry of grammar(device, 'exec')) if (entry.path[0] !== 'configure') entries.push({ path: ['do', ...entry.path], action: 'do:' + entry.action });
  }
  return entries;
}

function argumentValid(token: string, value: string, device: DeviceId) {
  if (token === '<interface>') return canonicalInterface(device, value) !== null;
  if (token === '<address>' || token === '<wildcard>') return ipv4Number(value) !== null;
  if (token === '<vlan>') return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 4094;
  if (token === '<process>') return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
  if (token === '<length>') return /^\d+$/.test(value) && Number(value) <= 512;
  if (token === '<area>') return (/^\d+$/.test(value) && Number(value) <= 4294967295) || ipv4Number(value) !== null;
  return token === '<text>' && value.length > 0;
}

function commandTokens(command: string) {
  return command.trim().split(/\s+/).filter(Boolean).reduce<string[]>((tokens, word) => {
    if (/^\d+\/\d+$/.test(word) && /^(f|fa|fas|fastethernet|g|gi|gig|gigabitethernet)$/i.test(tokens.at(-1) ?? '')) tokens[tokens.length - 1] += word;
    else tokens.push(word);
    return tokens;
  }, []);
}

function resolveTokens(device: DeviceId, mode: TerminalMode, tokens: string[]) {
  let candidates = grammar(device, mode);
  const canonical: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i];
    const options = [...new Set(candidates.map((entry) => entry.path[i]).filter(Boolean))];
    const exact = options.filter((word) => word.toLowerCase() === value.toLowerCase());
    const keywords = exact.length ? exact : options.filter((word) => !word.startsWith('<') && word.startsWith(value.toLowerCase()));
    if (keywords.length > 1) return { candidates: [], canonical, error: 'ambiguous', index: i };
    const selected = keywords[0] ?? options.find((word) => word.startsWith('<') && argumentValid(word, value, device));
    if (!selected) return { candidates: [], canonical, error: 'invalid', index: i };
    canonical.push(selected === '<interface>' ? canonicalInterface(device, value)! : selected.startsWith('<') ? value : selected);
    candidates = candidates.filter((entry) => entry.path[i] === selected);
    if (selected === '<text>') {
      canonical[canonical.length - 1] = tokens.slice(i).join(' ');
      return { candidates, canonical };
    }
  }
  return { candidates, canonical };
}

export function commandHelp(device: DeviceId, mode: TerminalMode, command: string) {
  if (device === 'branch-pc') return 'ip addr\nip route\nping <IPv4 address>\ntraceroute <IPv4 address>';
  const input = command.replace(/\?$/, '');
  const tokens = commandTokens(input);
  const partial = /\s$/.test(input) || !tokens.length ? '' : tokens.pop()!;
  const resolved = resolveTokens(device, mode, tokens);
  if (resolved.error) return '% Unrecognized command';
  const choices = new Set<string>();
  for (const entry of resolved.candidates) {
    const next = entry.path[tokens.length];
    if (!next && !partial) choices.add('<cr>');
    else if (next && (next.startsWith('<') || next.startsWith(partial.toLowerCase()))) {
      if (next === '<interface>') interfaces[device].filter((name) => !partial || name.toLowerCase().startsWith(partial.toLowerCase())).forEach((name) => choices.add(name));
      else choices.add(next);
    }
  }
  return [...choices].sort().map((word) => '  ' + word).join('\n') || '% Unrecognized command';
}

export function completeCommand(device: DeviceId, mode: TerminalMode, command: string) {
  if (device === 'branch-pc') return command;
  const tokens = commandTokens(command);
  const prefix = /\s$/.test(command) ? '' : tokens.pop() ?? '';
  const resolved = resolveTokens(device, mode, tokens);
  if (resolved.error) return command;
  const choices = [...new Set(resolved.candidates.map((entry) => entry.path[tokens.length]).filter((word) => word && !word.startsWith('<') && word.startsWith(prefix.toLowerCase())))];
  if (choices.length !== 1) return command;
  return [...resolved.canonical, choices[0]].join(' ') + ' ';
}

function parseError(command: string, kind: string, index: number) {
  if (kind === 'ambiguous') return `% Ambiguous command: "${command}"`;
  if (kind === 'incomplete') return '% Incomplete command.';
  const words = [...command.matchAll(/\S+/g)];
  return `${command}\n${' '.repeat(words[index]?.index ?? command.length)}^\n% Invalid input detected at '^' marker.`;
}

export function isRouter(device: DeviceId) {
  return device === 'br-r1' || device === 'hq-r1';
}

export function hasBranchLanOspf(state: SimState) {
  return advertised(state.brOspfNetworks, '192.168.20.1');
}

export function isVlanFixed(state: SimState) {
  return state.branchAccessVlan === 20;
}

export function routeHealth(state: SimState) {
  const accessPort = state.cablePort && state.cablePort !== 'console' ? state.cablePort : 'FastEthernet0/3';
  const accessVlanOk = state.portVlans[accessPort] === 20 && state.portModes[accessPort] === 'access';
  const carrier = interfaceUp('branch-pc', 'eth0', state);
  const gatewayReachable = carrier && accessVlanOk && state.portModes['FastEthernet0/1'] === 'access' && state.portVlans['FastEthernet0/1'] === 20 && interfaceUp('br-sw1', 'FastEthernet0/1', state);
  const ospfNeighborFull = !['br-r1:GigabitEthernet0/0', 'hq-r1:GigabitEthernet0/0'].some((key) => state.shutdownInterfaces.includes(key)) && ospfAreas(state.brOspfNetworks, '10.0.0.2').some((area) => ospfAreas(state.hqOspfNetworks, '10.0.0.1').includes(area));
  const hqReturnRoute = ospfNeighborFull && hasBranchLanOspf(state) && interfaceUp('br-r1','GigabitEthernet0/1',state);
  const hqRoute = ospfNeighborFull && advertised(state.hqOspfNetworks, '10.10.10.1') && !state.shutdownInterfaces.includes('hq-r1:GigabitEthernet0/1');
  return {
    accessVlanOk,
    carrier,
    gatewayReachable,
    branchLanAdvertised: hasBranchLanOspf(state),
    ospfNeighborFull,
    hqReturnRoute,
    hqRoute,
    endToEnd: gatewayReachable && hqReturnRoute && hqRoute,
  };
}

export type TopologyLink = {
  id: string;
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
  status: 'up' | 'blocked' | 'down';
  label: string;
  detail: string;
};

export function topologyLinks(state: SimState): TopologyLink[] {
  const health = routeHealth(state);
  const up = (...keys: string[]) => keys.every((key) => !state.shutdownInterfaces.includes(key));
  const accessUp = health.carrier;
  const port = state.cablePort;
  const portName = port?.replace('FastEthernet', 'Fa') ?? 'Unplugged';
  const uplinkUp = up('br-sw1:FastEthernet0/1', 'br-r1:GigabitEthernet0/1');
  const uplinkVlanOk = state.portModes['FastEthernet0/1'] === 'access' && state.portVlans['FastEthernet0/1'] === 20;
  const wanUp = up('br-r1:GigabitEthernet0/0', 'hq-r1:GigabitEthernet0/0');
  const serverUp = up('hq-r1:GigabitEthernet0/1');
  return [
    { id: 'access', from: 'Branch PC', to: 'BR-SW1', fromPort: 'eth0', toPort: portName, status: !accessUp ? 'down' : health.accessVlanOk ? 'up' : 'blocked', label: !accessUp ? 'No carrier' : health.accessVlanOk ? 'VLAN 20' : 'VLAN mismatch', detail: port === null ? 'PP-03 patch lead is disconnected' : port === 'console' ? 'PP-03 is connected to a serial console port, not Ethernet' : !accessUp ? `${portName} is shut down` : health.accessVlanOk ? 'Access port / VLAN 20' : `${portName}: ${state.portModes[port]}, VLAN ${state.portVlans[port]}; expected access VLAN 20` },
    { id: 'uplink', from: 'BR-SW1', to: 'BR-R1', fromPort: 'Fa0/1', toPort: 'Gi0/1', status: !uplinkUp ? 'down' : uplinkVlanOk ? 'up' : 'blocked', label: !uplinkUp ? 'Port down' : uplinkVlanOk ? 'Branch LAN' : 'VLAN mismatch', detail: !uplinkUp ? 'A branch uplink interface is shut down' : uplinkVlanOk ? '192.168.20.0/24' : `Fa0/1: ${state.portModes['FastEthernet0/1']}, VLAN ${state.portVlans['FastEthernet0/1']}; expected access VLAN 20` },
    { id: 'wan', from: 'BR-R1', to: 'HQ-R1', fromPort: 'Gi0/0', toPort: 'Gi0/0', status: !wanUp ? 'down' : health.ospfNeighborFull ? 'up' : 'blocked', label: !wanUp ? 'WAN down' : health.ospfNeighborFull ? 'OSPF FULL' : 'OSPF down', detail: !wanUp ? 'A WAN interface is shut down' : health.ospfNeighborFull ? '10.0.0.0/30' : 'Link up; no OSPF adjacency' },
    { id: 'server', from: 'HQ-R1', to: 'HQ Server', fromPort: 'Gi0/1', toPort: 'eth0', status: serverUp ? 'up' : 'down', label: serverUp ? 'HQ LAN' : 'Port down', detail: serverUp ? '10.10.10.0/24' : 'HQ-R1 Gi0/1 is shut down' },
  ];
}

export function promptFor(device: DeviceId, mode: TerminalMode) {
  const name = deviceLabels[device].replace('Branch PC', 'branch-pc');
  if (device === 'branch-pc') return 'branch-pc$';
  if (mode === 'user-exec') return `${name}>`;
  if (mode === 'config') return `${name}(config)#`;
  if (mode === 'interface') return `${name}(config-if)#`;
  if (mode === 'router-ospf') return `${name}(config-router)#`;
  return `${name}#`;
}


const addresses: Record<string, string> = {
  'br-r1:GigabitEthernet0/0': '10.0.0.2',
  'br-r1:GigabitEthernet0/1': '192.168.20.1',
  'hq-r1:GigabitEthernet0/0': '10.0.0.1',
  'hq-r1:GigabitEthernet0/1': '10.10.10.1',
};

function interfaceConfig(device: DeviceId, iface: string, state: SimState) {
  const key = `${device}:${iface}`;
  return [
    `interface ${iface}`,
    state.descriptions[key] ? ` description ${state.descriptions[key]}` : null,
    ...(device === 'br-sw1'
      ? [` switchport access vlan ${state.portVlans[iface]}`, ` switchport mode ${state.portModes[iface]}`]
      : [` ip address ${addresses[key]} ${iface.endsWith('0/0') ? '255.255.255.252' : '255.255.255.0'}`]),
    state.shutdownInterfaces.includes(key) ? ' shutdown' : ' no shutdown',
  ].filter(Boolean).join('\n');
}

function runningConfig(device: DeviceId, state: SimState) {
  const networks = device === 'br-r1' ? state.brOspfNetworks : state.hqOspfNetworks;
  return [
    'Building configuration...', '!', `hostname ${deviceLabels[device]}`, '!',
    ...(device === 'br-sw1' ? [...new Set([1, 10, 20, ...Object.values(state.portVlans)])].sort((a,b) => a-b).map((vlan) => `vlan ${vlan}\n name ${vlanName(vlan)}\n!`) : []),
    ...interfaces[device].map((iface) => interfaceConfig(device, iface, state) + '\n!'),
    ...(device !== 'br-sw1' ? ['router ospf 1', ` router-id ${device === 'br-r1' ? '2.2.2.2' : '1.1.1.1'}`, ...networks.map((network) => ` network ${network}`), '!'] : []),
    'end',
  ].join('\n');
}

export function configurationDiff(state: SimState) {
  const baseline = initialMissionState(state.missionId);
  const result: string[] = [];
  const compare = (context: string, before: string[], after: string[]) => {
    const removed = before.filter((line) => !after.includes(line)).map((line) => '- ' + line.trim());
    const added = after.filter((line) => !before.includes(line)).map((line) => '+ ' + line.trim());
    if (removed.length || added.length) result.push(context, ...removed, ...added, '');
  };
  for (const device of ['br-sw1', 'br-r1', 'hq-r1'] as DeviceId[]) {
    for (const iface of interfaces[device]) compare(`${deviceLabels[device]} / ${iface}`, interfaceConfig(device, iface, baseline).split('\n'), interfaceConfig(device, iface, state).split('\n'));
    if (device !== 'br-sw1') {
      const key = device === 'br-r1' ? 'brOspfNetworks' : 'hqOspfNetworks';
      compare(`${deviceLabels[device]} / router ospf 1`, baseline[key].map((line) => 'network ' + line), state[key].map((line) => 'network ' + line));
    }
  }
  if (state.cablePort !== baseline.cablePort) result.push('Physical patch / PP-03', `- ${baseline.cablePort ?? 'disconnected'}`, `+ ${state.cablePort ?? 'disconnected'}`);
  return result.join('\n').trimEnd() || '# No configuration changes';
}

function routeTable(device: DeviceId, state: SimState) {
  if (device === 'branch-pc') return 'default via 192.168.20.1 dev eth0 proto static\n192.168.20.0/24 dev eth0 proto kernel scope link src 192.168.20.45';
  const health = routeHealth(state);
  const routes = ['Codes: C - connected, L - local, O - OSPF', '', 'Gateway of last resort is not set', ''];
  for (const iface of interfaces[device]) {
    if (!interfaceUp(device,iface,state)) continue;
    const ip = addresses[`${device}:${iface}`];
    const network = ip.slice(0, ip.lastIndexOf('.')) + '.0';
    routes.push(`C    ${network}/${iface.endsWith('0/0') ? '30' : '24'} is directly connected, ${iface}`);
    routes.push(`L    ${ip}/32 is directly connected, ${iface}`);
  }
  if (device === 'br-r1' && health.hqRoute) routes.push('O    10.10.10.0/24 [110/2] via 10.0.0.1, 00:00:17, GigabitEthernet0/0');
  if (device === 'hq-r1' && health.hqReturnRoute) routes.push('O    192.168.20.0/24 [110/2] via 10.0.0.2, 00:00:11, GigabitEthernet0/0');
  return routes.join('\n');
}

function ipInterfaceBrief(device: DeviceId, state: SimState) {
  return ['Interface              IP-Address      OK? Method Status                Protocol', ...interfaces[device].map((iface) => {
    const down = state.shutdownInterfaces.includes(`${device}:${iface}`);
    const up = interfaceUp(device, iface, state);
    return `${iface.padEnd(23)}${(addresses[`${device}:${iface}`] ?? 'unassigned').padEnd(16)}YES manual ${(down ? 'administratively down' : up ? 'up' : 'down').padEnd(22)}${up ? 'up' : 'down'}`;
  })].join('\n');
}

function vlanName(vlan: number) {
  return vlan === 1 ? 'default' : vlan === 10 ? 'Guest-Staging' : vlan === 20 ? 'Branch-Users' : `VLAN${String(vlan).padStart(4, '0')}`;
}

function vlanBrief(state: SimState) {
  return ['VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------', ...[...new Set([1, 10, 20, ...Object.values(state.portVlans)])].sort((a,b) => a-b).map((vlan) => `${String(vlan).padEnd(5)}${vlanName(vlan).padEnd(33)}active    ${interfaces['br-sw1'].filter((iface) => state.portVlans[iface] === vlan && state.portModes[iface] === 'access').map((iface) => iface.replace('FastEthernet', 'Fa')).join(', ')}`)].join('\n');
}

function ospfNeighbor(device: DeviceId, state: SimState) {
  const header = 'Neighbor ID     Pri   State           Dead Time   Address         Interface';
  if (!routeHealth(state).ospfNeighborFull) return header;
  return header + (device === 'br-r1' ? '\n1.1.1.1           1   FULL/BDR        00:00:34    10.0.0.1        GigabitEthernet0/0' : '\n2.2.2.2           1   FULL/DR         00:00:34    10.0.0.2        GigabitEthernet0/0');
}

function ospfProtocols(device: DeviceId, state: SimState) {
  return ['Routing Protocol is "ospf 1"', `  Router ID ${device === 'br-r1' ? '2.2.2.2' : '1.1.1.1'}`, '  Routing for Networks:', ...(device === 'br-r1' ? state.brOspfNetworks : state.hqOspfNetworks).map((network) => `    ${network}`)].join('\n');
}

function interfaceDetails(device: DeviceId, iface: string, state: SimState, switchport = false) {
  const down = state.shutdownInterfaces.includes(`${device}:${iface}`);
  const up = interfaceUp(device, iface, state);
  if (switchport) return [`Name: ${iface.replace('FastEthernet', 'Fa')}`, 'Switchport: Enabled', `Administrative Mode: static ${state.portModes[iface]}`, `Operational Mode: ${up ? 'static ' + state.portModes[iface] : 'down'}`, `Access Mode VLAN: ${state.portVlans[iface]} (${vlanName(state.portVlans[iface])})`, 'Voice VLAN: none'].join('\n');
  return [`${iface} is ${down ? 'administratively down' : up ? 'up' : 'down'}, line protocol is ${up ? 'up' : 'down'}`, `  Hardware is ${device === 'br-sw1' ? 'Fast Ethernet' : 'Gigabit Ethernet'}`, ...(addresses[`${device}:${iface}`] ? [`  Internet address is ${addresses[`${device}:${iface}`]}/${iface.endsWith('0/0') ? 30 : 24}`] : []), '  MTU 1500 bytes, reliability 255/255', '  0 input errors, 0 CRC, 0 frame', '  0 output errors, 0 collisions'].join('\n');
}


function pingOutput(device: DeviceId, target: string, state: SimState): CommandResult {
  const health = routeHealth(state);
  const up = (key: string) => !state.shutdownInterfaces.includes(key);
  const wan = up('br-r1:GigabitEthernet0/0') && up('hq-r1:GigabitEthernet0/0');
  let success = false;
  if (device === 'branch-pc') {
    success = target === '192.168.20.45' || (target === '192.168.20.1' && health.gatewayReachable) || (target === '10.0.0.2' && health.gatewayReachable && up('br-r1:GigabitEthernet0/0')) || (target === '10.0.0.1' && health.gatewayReachable && wan && health.hqReturnRoute) || (['10.10.10.1', '10.10.10.10'].includes(target) && health.endToEnd);
    return {
      output: `PING ${target} (${target}) 56(84) bytes of data.\n` + (success ? [1,2,3].map((seq) => `64 bytes from ${target}: icmp_seq=${seq} ttl=62 time=8.${seq} ms`).join('\n') : health.gatewayReachable ? '' : 'From 192.168.20.45 icmp_seq=1 Destination Host Unreachable') + `\n\n--- ${target} ping statistics ---\n3 packets transmitted, ${success ? '3 received, 0%' : '0 received, 100%'} packet loss`,
      status: success ? 'ok' : 'error',
      ...(success && target === '10.10.10.10' ? { state: { ...state, verifiedBranchToHq: true } } : {}),
    };
  }
  if (device === 'br-sw1') return { output: '% No source IP address is configured on this Layer 2 switch.', status: 'error' };
  if (device === 'br-r1') success = (Object.entries(addresses).some(([key, ip]) => key.startsWith(device + ':') && ip === target && up(key))) || (target === '10.0.0.1' && wan) || (target === '192.168.20.45' && health.gatewayReachable) || (['10.10.10.1','10.10.10.10'].includes(target) && health.hqRoute);
  else success = Object.entries(addresses).some(([key, ip]) => key.startsWith(device + ':') && ip === target && up(key)) || (target === '10.10.10.10' && up('hq-r1:GigabitEthernet0/1')) || (target === '10.0.0.2' && wan) || (target === '192.168.20.1' && health.hqReturnRoute) || (target === '192.168.20.45' && health.hqReturnRoute && health.gatewayReachable);
  return { output: `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:\n${success ? '!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 4/6/8 ms' : '.....\nSuccess rate is 0 percent (0/5)'}`, status: success ? 'ok' : 'error' };
}

function tracerouteOutput(device: DeviceId, target: string, state: SimState): CommandResult {
  const result = pingOutput(device, target, state);
  const hops = target === '10.10.10.10' ? device === 'branch-pc' ? ['192.168.20.1', '10.0.0.1', target] : device === 'br-r1' ? ['10.0.0.1', target] : [target] : [target];
  return { output: `Tracing the route to ${target}\n` + (result.status === 'error' ? '  1  * * *\n  2  * * *\n  3  * * *' : hops.map((hop,i) => `  ${i + 1}  ${hop}  4 ms  6 ms  8 ms`).join('\n')), status: result.status };
}

function runPcCommand(command: string, state: SimState): CommandResult {
  const cmd = normalizeCommand(command);
  if (cmd === 'help' || cmd === '?') {
    return {
      output:
        'Supported client commands:\n  ip addr\n  ip route\n  ping 192.168.20.1\n  ping 10.10.10.10\n  traceroute 10.10.10.10',
      status: 'info',
    };
  }
  if (cmd === 'ip addr' || cmd === 'ip a' || cmd === 'ifconfig') {
    return {
      state: observe(state, 'pc-address'),
      output:
        `2: eth0: <BROADCAST,MULTICAST,UP,${routeHealth(state).carrier ? 'LOWER_UP' : 'NO-CARRIER'}> mtu 1500 state ${routeHealth(state).carrier ? 'UP' : 'DOWN'}\n    inet 192.168.20.45/24 brd 192.168.20.255 scope global eth0\n    ether 00:50:56:ad:20:45`,
    };
  }
  if (cmd === 'ip route' || cmd === 'route -n') {
    return { output: routeTable('branch-pc', state), state: observe(state, 'pc-route') };
  }
  if (cmd.startsWith('ping ')) {
    const result = pingOutput('branch-pc', command.trim().slice(5), state);
    return cmd === 'ping 192.168.20.1' && routeHealth(state).gatewayReachable
      ? { ...result, state: observe(result.state ?? state, 'gateway-test') } : result;
  }
  if (cmd.startsWith('traceroute ') || cmd.startsWith('tracepath ')) {
    const target = command.trim().replace(/^(traceroute|tracepath)\s+/i, '');
    return tracerouteOutput('branch-pc', target, state);
  }
  return {
    output: `branch-pc: ${command}: command not found`,
    status: 'error',
    state: { ...state, badCommands: state.badCommands + 1 },
  };
}

export function runCommand(device: DeviceId, command: string, state: SimState, mode: TerminalMode, currentInterface: string | null): CommandResult {
  if (device === 'branch-pc') return runPcCommand(command, state);
  if (!command.trim() || command.trim().startsWith('!')) return { output: '' };
  if (command.includes('?')) return { output: commandHelp(device, mode, command), status: 'info' };
  const fail = (output: string): CommandResult => ({ output, status: 'error', state: { ...state, badCommands: state.badCommands + 1 } });
  const pipe = command.indexOf('|');
  if (pipe >= 0) {
    const base = command.slice(0, pipe).trim();
    if (!/^(?:do\s+)?sh\w*\s/i.test(base)) return fail(parseError(command, 'invalid', 0));
    const filter = /^\s*(\S+)\s+(.+?)\s*$/.exec(command.slice(pipe + 1));
    if (!filter) return fail('% Incomplete command.');
    const methods = ['include', 'exclude', 'begin'].filter((word) => word.startsWith(filter[1].toLowerCase()));
    if (methods.length !== 1) return fail(parseError(command, 'invalid', commandTokens(base).length));
    let pattern: RegExp;
    try { pattern = new RegExp(filter[2]); } catch { return fail('% Invalid regular expression.'); }
    const result = runCommand(device, base, state, mode, currentInterface);
    if (result.status === 'error') return result;
    const lines = result.output.split('\n');
    const first = lines.findIndex((line) => pattern.test(line));
    return { ...result, output: (methods[0] === 'begin' ? first < 0 ? [] : lines.slice(first) : lines.filter((line) => pattern.test(line) === (methods[0] === 'include'))).join('\n') };
  }
  const tokens = commandTokens(command);
  const resolved = resolveTokens(device, mode, tokens);
  if (resolved.error) return fail(parseError(command, resolved.error, resolved.index ?? 0));
  const entry = resolved.candidates.find((candidate) => candidate.path.length === resolved.canonical.length);
  if (!entry) return fail('% Incomplete command.');
  const words = resolved.canonical;
  const action = entry.action;
  if (action.startsWith('do:')) {
    const result = runCommand(device, words.slice(1).join(' '), state, 'exec', null);
    return { ...result, nextMode: mode, nextInterface: currentInterface };
  }
  const update = (changes: Partial<SimState>): CommandResult => {
    const changed = { ...state, ...changes };
    const health = routeHealth(changed);
    return { output: '', state: { ...changed, observations: health.gatewayReachable ? changed.observations : changed.observations.filter((item) => item !== 'gateway-test'), verifiedBranchToHq: state.verifiedBranchToHq && health.endToEnd } };
  };
  if (action === 'help') return { output: 'Use ? for commands in the current mode, or after a keyword for available arguments.\nOnly the interfaces and features exposed by this lab are simulated.', status: 'info' };
  if (action === 'enable') return { output: '', nextMode: 'exec' };
  if (action === 'disable') return { output: '', nextMode: 'user-exec', nextInterface: null };
  if (action === 'end') return { output: '', nextMode: 'exec', nextInterface: null };
  if (action === 'exit') return { output: '', nextMode: mode === 'interface' || mode === 'router-ospf' ? 'config' : mode === 'config' ? 'exec' : 'user-exec', nextInterface: null };
  if (action === 'configure terminal') return { output: 'Enter configuration commands, one per line. End with CNTL/Z.', nextMode: 'config', nextInterface: null };
  if (action === 'interface <interface>') return { output: '', nextMode: 'interface', nextInterface: words[1] };
  if (action === 'router ospf <process>') return words[2] === '1' ? { output: '', nextMode: 'router-ospf', nextInterface: null } : fail('% This lab models OSPF process 1 only.');
  if (action === 'save') return { output: 'Building configuration...\n[OK]', state: { ...state, startupConfigs: { ...state.startupConfigs, [device]: runningConfig(device, state) } } };
  if (action === 'terminal length <length>') return { output: '' };
  if (action === 'ping <address>') return pingOutput(device, words[1], state);
  if (action === 'traceroute <address>') return tracerouteOutput(device, words[1], state);
  if (words[0] === 'show') {
    let output = '';
    if (action === 'show running-config') output = runningConfig(device, state);
    else if (action === 'show running-config interface <interface>') output = interfaceConfig(device, words[3], state) + '\nend';
    else if (action === 'show startup-config') output = state.startupConfigs[device] ?? runningConfig(device, initialMissionState(state.missionId));
    else if (action === 'show ip interface brief') output = ipInterfaceBrief(device, state);
    else if (action === 'show ip ospf neighbor') output = ospfNeighbor(device, state);
    else if (action === 'show ip protocols') output = ospfProtocols(device, state);
    else if (action.startsWith('show ip route')) {
      output = routeTable(device, state);
      if (words[3]) output = output.split('\n').filter((line) => line.startsWith(words[3] === 'ospf' ? 'O ' : 'C ')).join('\n');
    } else if (action === 'show vlan' || action === 'show vlan brief') output = vlanBrief(state);
    else if (action === 'show interfaces <interface> switchport') output = interfaceDetails(device, words[2], state, true);
    else if (action === 'show interfaces status') output = ['Port      Name               Status       Vlan       Duplex Speed Type', ...interfaces[device].map((iface) => `${iface.replace('FastEthernet', 'Fa').padEnd(10)}${(state.descriptions[`${device}:${iface}`] ?? '').slice(0, 18).padEnd(19)}${(state.shutdownInterfaces.includes(`${device}:${iface}`) ? 'disabled' : interfaceUp(device, iface, state) ? 'connected' : 'notconnect').padEnd(13)}${String(state.portModes[iface] === 'trunk' ? 'trunk' : state.portVlans[iface]).padEnd(11)}a-full a-100 10/100BaseTX`)].join('\n');
    else if (action === 'show interfaces trunk') output = ['Port      Mode         Encapsulation  Status        Native vlan', ...interfaces[device].filter((iface) => state.portModes[iface] === 'trunk' && !state.shutdownInterfaces.includes(`${device}:${iface}`)).map((iface) => `${iface.replace('FastEthernet', 'Fa')}     on           802.1q         trunking      1`)].join('\n');
    else if (action === 'show interfaces <interface>' || action === 'show ip interface <interface>') output = interfaceDetails(device, words.at(-1)!, state);
    else if (action === 'show interfaces' || action === 'show ip interface') output = interfaces[device].map((iface) => interfaceDetails(device, iface, state)).join('\n\n');
    else if (action === 'show version') output = `${deviceLabels[device]} - NetOps Lab IOS-compatible simulator\nPlatform: ${deviceKinds[device]}\nSimulated interfaces: ${interfaces[device].join(', ')}\nThis is a simulated CLI, not a Cisco IOS image.`;
    else if (action === 'show cdp neighbors') output = 'Device ID        Local Intrfce       Holdtme    Capability    Port ID\n' + (device === 'br-sw1' ? 'BR-R1            Fas 0/1             144        R             Gig 0/1' : device === 'br-r1' ? 'BR-SW1           Gig 0/1             144        S             Fas 0/1\nHQ-R1            Gig 0/0             155        R             Gig 0/0' : 'BR-R1            Gig 0/0             155        R             Gig 0/0');
    let inspected = state;
    if (device === 'br-sw1' && (action === 'show vlan' || action === 'show vlan brief' || action === 'show interfaces status' || action === 'show running-config' || (action === 'show interfaces <interface> switchport' && words[2] === 'FastEthernet0/3') || (action === 'show running-config interface <interface>' && words[3] === 'FastEthernet0/3'))) inspected = observe(inspected, 'access-vlan');
    if (device === 'hq-r1' && (action === 'show ip route' || action === 'show ip route ospf')) inspected = observe(inspected, 'return-route');
    return { output, state: { ...inspected, usedShowCommands: state.usedShowCommands + 1 } };
  }
  if (action.includes('network <address>')) {
    const remove = words[0] === 'no';
    const offset = remove ? 2 : 1;
    const areaValue = words[offset + 3];
    const area = areaValue.includes('.') ? ipv4Number(areaValue)! : Number(areaValue);
    const line = `${words[offset]} ${words[offset + 1]} area ${area}`;
    const key = device === 'br-r1' ? 'brOspfNetworks' : 'hqOspfNetworks';
    const networks = state[key];
    return update({ [key]: remove ? networks.filter((item) => item !== line) : [...new Set([...networks, line])] });
  }
  if (mode === 'interface' && currentInterface) {
    const key = `${device}:${currentInterface}`;
    if (action === 'shutdown' || action === 'no shutdown') return update({ shutdownInterfaces: action === 'shutdown' ? [...new Set([...state.shutdownInterfaces, key])] : state.shutdownInterfaces.filter((item) => item !== key) });
    if (action === 'description <text>' || action === 'no description') return update({ descriptions: { ...state.descriptions, [key]: action === 'no description' ? '' : words[1] } });
    if (action === 'switchport mode access' || action === 'switchport mode trunk') return update({ portModes: { ...state.portModes, [currentInterface]: words[2] as 'access' | 'trunk' } });
    if (action === 'switchport access vlan <vlan>' || action === 'no switchport access vlan') {
      const vlan = action === 'no switchport access vlan' ? 1 : Number(words[3]);
      return update({ portVlans: { ...state.portVlans, [currentInterface]: vlan }, ...(currentInterface === 'FastEthernet0/3' ? { branchAccessVlan: vlan } : {}) });
    }
  }
  return fail(parseError(command, 'invalid', 0));
}
