'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
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

type DeviceId = 'branch-pc' | 'br-sw1' | 'br-r1' | 'hq-r1';
type TerminalMode = 'exec' | 'config' | 'interface' | 'router-ospf';

type SimState = {
  branchAccessVlan: number;
  brOspfNetworks: string[];
  verifiedBranchToHq: boolean;
  viewedSubnet: boolean;
  usedShowCommands: number;
  badCommands: number;
};

type TerminalEntry = {
  prompt: string;
  command: string;
  output: string;
  status: 'ok' | 'error' | 'info';
};

type CommandResult = {
  output: string;
  status?: TerminalEntry['status'];
  nextMode?: TerminalMode;
  nextInterface?: string | null;
  state?: SimState;
};

const deviceLabels: Record<DeviceId, string> = {
  'branch-pc': 'Branch PC',
  'br-sw1': 'BR-SW1',
  'br-r1': 'BR-R1',
  'hq-r1': 'HQ-R1',
};

const deviceKinds: Record<DeviceId, string> = {
  'branch-pc': 'Linux client',
  'br-sw1': 'Catalyst access switch',
  'br-r1': 'Cisco branch router',
  'hq-r1': 'Cisco HQ router',
};

const initialState: SimState = {
  branchAccessVlan: 10,
  brOspfNetworks: ['10.0.0.0 0.0.0.3 area 0'],
  verifiedBranchToHq: false,
  viewedSubnet: false,
  usedShowCommands: 0,
  badCommands: 0,
};

const starterHistory: TerminalEntry[] = [
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

function normalizeCommand(command: string) {
  return command.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isShow(command: string) {
  return command === 'show' || command.startsWith('show ') || command === 'sh' || command.startsWith('sh ');
}

function isSwitch(device: DeviceId) {
  return device === 'br-sw1';
}

function isRouter(device: DeviceId) {
  return device === 'br-r1' || device === 'hq-r1';
}

function hasBranchLanOspf(state: SimState) {
  return state.brOspfNetworks.includes('192.168.20.0 0.0.0.255 area 0');
}

function isVlanFixed(state: SimState) {
  return state.branchAccessVlan === 20;
}

function routeHealth(state: SimState) {
  return {
    accessVlanOk: isVlanFixed(state),
    gatewayReachable: isVlanFixed(state),
    branchLanAdvertised: hasBranchLanOspf(state),
    ospfNeighborFull: true,
    hqReturnRoute: hasBranchLanOspf(state),
    endToEnd: isVlanFixed(state) && hasBranchLanOspf(state),
  };
}

function promptFor(device: DeviceId, mode: TerminalMode) {
  const name = deviceLabels[device].replace('Branch PC', 'branch-pc');
  if (device === 'branch-pc') return 'branch-pc$';
  if (mode === 'config') return `${name}(config)#`;
  if (mode === 'interface') return `${name}(config-if)#`;
  if (mode === 'router-ospf') return `${name}(config-router)#`;
  return `${name}#`;
}

function invalidCisco(command: string) {
  const marker = command.length > 0 ? `${' '.repeat(Math.min(command.length, 18))}^` : '^';
  return `% Invalid input detected at '^' marker.\n\n${command}\n${marker}`;
}

function countShowUse(command: string, state: SimState) {
  if (!isShow(command)) return state;
  return { ...state, usedShowCommands: state.usedShowCommands + 1 };
}

function switchRunningConfig(state: SimState) {
  return [
    'Building configuration...',
    '',
    'Current configuration : 1812 bytes',
    '!',
    'hostname BR-SW1',
    '!',
    'vlan 10',
    ' name Guest-Staging',
    'vlan 20',
    ' name Branch-Users',
    '!',
    'interface FastEthernet0/1',
    ' description uplink to BR-R1 Gi0/1',
    ' switchport mode trunk',
    ' switchport trunk allowed vlan 20',
    '!',
    'interface FastEthernet0/3',
    ' description Branch training workstation',
    ' switchport mode access',
    ` switchport access vlan ${state.branchAccessVlan}`,
    ' spanning-tree portfast',
    '!',
    'end',
  ].join('\n');
}

function routerRunningConfig(device: DeviceId, state: SimState) {
  if (device === 'hq-r1') {
    return [
      'Building configuration...',
      '',
      'Current configuration : 2310 bytes',
      '!',
      'hostname HQ-R1',
      '!',
      'interface GigabitEthernet0/0',
      ' description WAN to BR-R1',
      ' ip address 10.0.0.1 255.255.255.252',
      ' no shutdown',
      '!',
      'interface GigabitEthernet0/1',
      ' description HQ server network',
      ' ip address 10.10.10.1 255.255.255.0',
      ' no shutdown',
      '!',
      'router ospf 1',
      ' router-id 1.1.1.1',
      ' network 10.0.0.0 0.0.0.3 area 0',
      ' network 10.10.10.0 0.0.0.255 area 0',
      '!',
      'end',
    ].join('\n');
  }

  return [
    'Building configuration...',
    '',
    'Current configuration : 2242 bytes',
    '!',
    'hostname BR-R1',
    '!',
    'interface GigabitEthernet0/0',
    ' description WAN to HQ-R1',
    ' ip address 10.0.0.2 255.255.255.252',
    ' no shutdown',
    '!',
    'interface GigabitEthernet0/1',
    ' description trunk to BR-SW1',
    ' ip address 192.168.20.1 255.255.255.0',
    ' no shutdown',
    '!',
    'router ospf 1',
    ' router-id 2.2.2.2',
    ...state.brOspfNetworks.map((network) => ` network ${network}`),
    '!',
    'end',
  ].join('\n');
}

function routeTable(device: DeviceId, state: SimState) {
  if (device === 'branch-pc') {
    return [
      'default via 192.168.20.1 dev eth0 proto static',
      '192.168.20.0/24 dev eth0 proto kernel scope link src 192.168.20.45',
    ].join('\n');
  }

  if (device === 'br-r1') {
    return [
      'Codes: C - connected, L - local, O - OSPF',
      '',
      'Gateway of last resort is not set',
      '',
      'C    10.0.0.0/30 is directly connected, GigabitEthernet0/0',
      'L    10.0.0.2/32 is directly connected, GigabitEthernet0/0',
      'C    192.168.20.0/24 is directly connected, GigabitEthernet0/1',
      'L    192.168.20.1/32 is directly connected, GigabitEthernet0/1',
      'O    10.10.10.0/24 [110/2] via 10.0.0.1, 00:00:17, GigabitEthernet0/0',
    ].join('\n');
  }

  const branchRoute = hasBranchLanOspf(state)
    ? ['O    192.168.20.0/24 [110/2] via 10.0.0.2, 00:00:11, GigabitEthernet0/0']
    : [];

  return [
    'Codes: C - connected, L - local, O - OSPF',
    '',
    'Gateway of last resort is not set',
    '',
    'C    10.0.0.0/30 is directly connected, GigabitEthernet0/0',
    'L    10.0.0.1/32 is directly connected, GigabitEthernet0/0',
    'C    10.10.10.0/24 is directly connected, GigabitEthernet0/1',
    'L    10.10.10.1/32 is directly connected, GigabitEthernet0/1',
    ...branchRoute,
  ].join('\n');
}

function ipInterfaceBrief(device: DeviceId) {
  if (device === 'br-sw1') {
    return [
      'Interface              IP-Address      OK? Method Status                Protocol',
      'Vlan1                  unassigned      YES unset  administratively down down',
      'Vlan20                 unassigned      YES unset  up                    up',
      'FastEthernet0/1        unassigned      YES unset  up                    up',
      'FastEthernet0/3        unassigned      YES unset  up                    up',
    ].join('\n');
  }

  if (device === 'br-r1') {
    return [
      'Interface              IP-Address      OK? Method Status                Protocol',
      'GigabitEthernet0/0     10.0.0.2        YES manual up                    up',
      'GigabitEthernet0/1     192.168.20.1    YES manual up                    up',
    ].join('\n');
  }

  return [
    'Interface              IP-Address      OK? Method Status                Protocol',
    'GigabitEthernet0/0     10.0.0.1        YES manual up                    up',
    'GigabitEthernet0/1     10.10.10.1      YES manual up                    up',
  ].join('\n');
}

function vlanBrief(state: SimState) {
  const vlan10Ports = state.branchAccessVlan === 10 ? 'Fa0/3' : '';
  const vlan20Ports = state.branchAccessVlan === 20 ? 'Fa0/3' : '';

  return [
    'VLAN Name                             Status    Ports',
    '---- -------------------------------- --------- -------------------------------',
    `1    default                          active    Fa0/2, Fa0/4, Fa0/5, Fa0/6`,
    `10   Guest-Staging                    active    ${vlan10Ports}`,
    `20   Branch-Users                     active    ${vlan20Ports}`,
    '99   Network-Management               active',
  ].join('\n');
}

function ospfNeighbor() {
  return [
    'Neighbor ID     Pri   State           Dead Time   Address         Interface',
    '1.1.1.1           1   FULL/BDR        00:00:34    10.0.0.1        GigabitEthernet0/0',
  ].join('\n');
}

function ospfProtocols(device: DeviceId, state: SimState) {
  const networks =
    device === 'br-r1'
      ? state.brOspfNetworks
      : ['10.0.0.0 0.0.0.3 area 0', '10.10.10.0 0.0.0.255 area 0'];

  return [
    'Routing Protocol is "ospf 1"',
    '  Router ID configured from router-id command',
    '  Number of areas in this router is 1. 1 normal 0 stub 0 nssa',
    '  Area BACKBONE(0)',
    '  Routing for Networks:',
    ...networks.map((network) => `    ${network}`),
    '  Routing Information Sources:',
    '    Gateway         Distance      Last Update',
    '    10.0.0.1             110      00:00:17',
  ].join('\n');
}

function pingOutput(device: DeviceId, target: string, state: SimState) {
  const health = routeHealth(state);
  const normalizedTarget = target.trim();

  if (device === 'branch-pc') {
    if (normalizedTarget === '192.168.20.1') {
      if (!health.gatewayReachable) {
        return {
          output:
            'PING 192.168.20.1 (192.168.20.1) 56(84) bytes of data.\nFrom 192.168.20.45 icmp_seq=1 Destination Host Unreachable\nFrom 192.168.20.45 icmp_seq=2 Destination Host Unreachable\n\n--- 192.168.20.1 ping statistics ---\n2 packets transmitted, 0 received, +2 errors, 100% packet loss',
          status: 'error' as const,
        };
      }
      return {
        output:
          'PING 192.168.20.1 (192.168.20.1) 56(84) bytes of data.\n64 bytes from 192.168.20.1: icmp_seq=1 ttl=255 time=0.7 ms\n64 bytes from 192.168.20.1: icmp_seq=2 ttl=255 time=0.6 ms\n\n--- 192.168.20.1 ping statistics ---\n2 packets transmitted, 2 received, 0% packet loss',
      };
    }

    if (normalizedTarget === '10.10.10.10') {
      if (!health.gatewayReachable) {
        return {
          output:
            'PING 10.10.10.10 (10.10.10.10) 56(84) bytes of data.\nFrom 192.168.20.45 icmp_seq=1 Destination Host Unreachable\n\nThe local switchport is not placing this host in the routed Branch-Users VLAN.',
          status: 'error' as const,
        };
      }
      if (!health.hqReturnRoute) {
        return {
          output:
            'PING 10.10.10.10 (10.10.10.10) 56(84) bytes of data.\nRequest timed out.\nRequest timed out.\n\nThe request reaches the WAN, but HQ-R1 has no OSPF route back to 192.168.20.0/24.',
          status: 'error' as const,
        };
      }
      return {
        output:
          'PING 10.10.10.10 (10.10.10.10) 56(84) bytes of data.\n64 bytes from 10.10.10.10: icmp_seq=1 ttl=62 time=8.4 ms\n64 bytes from 10.10.10.10: icmp_seq=2 ttl=62 time=8.1 ms\n64 bytes from 10.10.10.10: icmp_seq=3 ttl=62 time=8.0 ms\n\n--- 10.10.10.10 ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss',
        state: { ...state, verifiedBranchToHq: true },
      };
    }
  }

  if (isRouter(device) && (normalizedTarget === '10.10.10.10' || normalizedTarget === '192.168.20.45')) {
    const success =
      device === 'br-r1'
        ? normalizedTarget === '10.10.10.10'
        : normalizedTarget === '192.168.20.45' && health.hqReturnRoute;
    if (success) {
      return {
        output:
          'Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos, timeout is 2 seconds:\n!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 4/6/8 ms',
      };
    }
  }

  return {
    output: `PING ${normalizedTarget}: no simulated response for this target in the current lab.`,
    status: 'error' as const,
  };
}

function tracerouteOutput(device: DeviceId, target: string, state: SimState) {
  const health = routeHealth(state);
  const normalizedTarget = target.trim();

  if (device !== 'branch-pc' || normalizedTarget !== '10.10.10.10') {
    return {
      output: `traceroute to ${normalizedTarget}: target is outside this mission scope.`,
      status: 'error' as const,
    };
  }

  if (!health.gatewayReachable) {
    return {
      output:
        'traceroute to 10.10.10.10, 30 hops max\n 1  * * *\n\nNo first hop. The Branch PC cannot reach its default gateway.',
      status: 'error' as const,
    };
  }

  if (!health.hqReturnRoute) {
    return {
      output:
        'traceroute to 10.10.10.10, 30 hops max\n 1  192.168.20.1  0.7 ms\n 2  10.0.0.1  7.9 ms\n 3  * * *\n\nTraffic arrives at HQ, but replies cannot find the Branch LAN.',
      status: 'error' as const,
    };
  }

  return {
    output:
      'traceroute to 10.10.10.10, 30 hops max\n 1  192.168.20.1  0.7 ms\n 2  10.0.0.1  7.6 ms\n 3  10.10.10.10  8.2 ms',
  };
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
      output:
        '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.20.45/24 brd 192.168.20.255 scope global eth0\n    ether 00:50:56:ad:20:45',
    };
  }
  if (cmd === 'ip route' || cmd === 'route -n') {
    return { output: routeTable('branch-pc', state) };
  }
  if (cmd.startsWith('ping ')) return pingOutput('branch-pc', command.trim().slice(5), state);
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

function runSwitchCommand(
  command: string,
  state: SimState,
  mode: TerminalMode,
  currentInterface: string | null,
): CommandResult {
  const cmd = normalizeCommand(command);

  if (cmd === 'help' || cmd === '?') {
    return {
      output:
        'Useful BR-SW1 commands:\n  show vlan brief\n  show interfaces fa0/3 switchport\n  show interfaces status\n  show running-config\n  configure terminal\n  interface fa0/3\n  switchport access vlan 20\n  end',
      status: 'info',
    };
  }

  if (mode === 'exec') {
    const counted = countShowUse(cmd, state);
    if (cmd === 'show vlan brief' || cmd === 'sh vlan brief') return { output: vlanBrief(state), state: counted };
    if (
      cmd === 'show interfaces fa0/3 switchport' ||
      cmd === 'sh int fa0/3 switchport' ||
      cmd === 'sh interfaces fa0/3 switchport' ||
      cmd === 'show int fa0/3 switchport'
    ) {
      return {
        output: [
          'Name: Fa0/3',
          'Switchport: Enabled',
          'Administrative Mode: static access',
          'Operational Mode: static access',
          `Access Mode VLAN: ${state.branchAccessVlan} (${state.branchAccessVlan === 20 ? 'Branch-Users' : 'Guest-Staging'})`,
          'Voice VLAN: none',
        ].join('\n'),
        state: counted,
      };
    }
    if (cmd === 'show interfaces status' || cmd === 'sh int status') {
      return {
        output: [
          'Port      Name               Status       Vlan       Duplex Speed Type',
          'Fa0/1     uplink-BR-R1       connected    trunk      a-full a-100 10/100BaseTX',
          `Fa0/3     branch-workstation connected    ${state.branchAccessVlan}         a-full a-100 10/100BaseTX`,
        ].join('\n'),
        state: counted,
      };
    }
    if (cmd === 'show ip interface brief' || cmd === 'sh ip int br') {
      return { output: ipInterfaceBrief('br-sw1'), state: counted };
    }
    if (cmd === 'show running-config' || cmd === 'show run' || cmd === 'sh run') {
      return { output: switchRunningConfig(state), state: counted };
    }
    if (cmd === 'configure terminal' || cmd === 'conf t') {
      return { output: 'Enter configuration commands, one per line. End with CNTL/Z.', nextMode: 'config' };
    }
    return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
  }

  if (mode === 'config') {
    if (cmd === 'end') return { output: '', nextMode: 'exec' };
    if (cmd === 'exit') return { output: '', nextMode: 'exec' };
    if (cmd === 'interface fa0/3' || cmd === 'int fa0/3' || cmd === 'interface fastethernet0/3') {
      return { output: '', nextMode: 'interface', nextInterface: 'FastEthernet0/3' };
    }
    return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
  }

  if (mode === 'interface') {
    if (cmd === 'end') return { output: '', nextMode: 'exec', nextInterface: null };
    if (cmd === 'exit') return { output: '', nextMode: 'config', nextInterface: null };
    if (currentInterface !== 'FastEthernet0/3') {
      return { output: '% This mission only exposes Fa0/3 for switchport changes.', status: 'error' };
    }
    if (cmd === 'switchport mode access') return { output: '' };
    if (cmd === 'switchport access vlan 20') {
      return {
        output: 'BR-SW1: Fa0/3 moved to VLAN 20 (Branch-Users). Link will forward to the routed branch gateway.',
        state: { ...state, branchAccessVlan: 20 },
      };
    }
    if (cmd.startsWith('switchport access vlan ')) {
      const vlan = Number(cmd.replace('switchport access vlan ', ''));
      if (Number.isFinite(vlan)) {
        return {
          output: `% VLAN ${vlan} does not satisfy this ticket. Branch users belong in VLAN 20.`,
          status: 'error',
          state: { ...state, branchAccessVlan: vlan, badCommands: state.badCommands + 1 },
        };
      }
    }
    if (cmd === 'no shutdown') return { output: '' };
    return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
  }

  return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
}

function runRouterCommand(
  device: DeviceId,
  command: string,
  state: SimState,
  mode: TerminalMode,
): CommandResult {
  const cmd = normalizeCommand(command);

  if (cmd === 'help' || cmd === '?') {
    return {
      output:
        'Useful router commands:\n  show ip interface brief\n  show ip route\n  show ip ospf neighbor\n  show ip protocols\n  show running-config\n  configure terminal\n  router ospf 1\n  network 192.168.20.0 0.0.0.255 area 0\n  end\n  ping 10.10.10.10',
      status: 'info',
    };
  }

  if (mode === 'exec') {
    const counted = countShowUse(cmd, state);
    if (cmd === 'show ip interface brief' || cmd === 'sh ip int br') {
      return { output: ipInterfaceBrief(device), state: counted };
    }
    if (cmd === 'show ip route' || cmd === 'sh ip route') return { output: routeTable(device, state), state: counted };
    if (cmd === 'show ip ospf neighbor' || cmd === 'sh ip ospf neigh' || cmd === 'sh ip ospf neighbor') {
      return { output: ospfNeighbor(), state: counted };
    }
    if (cmd === 'show ip protocols' || cmd === 'sh ip protocols') {
      return { output: ospfProtocols(device, state), state: counted };
    }
    if (cmd === 'show running-config' || cmd === 'show run' || cmd === 'sh run') {
      return { output: routerRunningConfig(device, state), state: counted };
    }
    if (cmd === 'configure terminal' || cmd === 'conf t') {
      return { output: 'Enter configuration commands, one per line. End with CNTL/Z.', nextMode: 'config' };
    }
    if (cmd.startsWith('ping ')) return pingOutput(device, command.trim().slice(5), state);
    if (cmd.startsWith('traceroute ') || cmd.startsWith('trace ')) {
      const target = command.trim().replace(/^(traceroute|trace)\s+/i, '');
      return tracerouteOutput(device, target, state);
    }
    return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
  }

  if (mode === 'config') {
    if (cmd === 'end') return { output: '', nextMode: 'exec' };
    if (cmd === 'exit') return { output: '', nextMode: 'exec' };
    if (cmd === 'router ospf 1') {
      return { output: '', nextMode: 'router-ospf' };
    }
    return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
  }

  if (mode === 'router-ospf') {
    if (cmd === 'end') return { output: '', nextMode: 'exec' };
    if (cmd === 'exit') return { output: '', nextMode: 'config' };
    if (device !== 'br-r1') {
      return {
        output: '% HQ-R1 is already advertising the HQ networks. The missing route is on BR-R1.',
        status: 'error',
        state: { ...state, badCommands: state.badCommands + 1 },
      };
    }
    if (cmd === 'network 192.168.20.0 0.0.0.255 area 0') {
      const networks = state.brOspfNetworks.includes('192.168.20.0 0.0.0.255 area 0')
        ? state.brOspfNetworks
        : [...state.brOspfNetworks, '192.168.20.0 0.0.0.255 area 0'];
      return {
        output: 'OSPF: BR-R1 is now advertising 192.168.20.0/24 into area 0.',
        state: { ...state, brOspfNetworks: networks },
      };
    }
    if (cmd.startsWith('network ')) {
      return {
        output:
          '% Network statement accepted by syntax, but it does not match the Branch LAN needed for this ticket.',
        status: 'error',
        state: { ...state, badCommands: state.badCommands + 1 },
      };
    }
    return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
  }

  return { output: invalidCisco(command), status: 'error', state: { ...state, badCommands: state.badCommands + 1 } };
}

function runCommand(
  device: DeviceId,
  command: string,
  state: SimState,
  mode: TerminalMode,
  currentInterface: string | null,
): CommandResult {
  if (device === 'branch-pc') return runPcCommand(command, state);
  if (isSwitch(device)) return runSwitchCommand(command, state, mode, currentInterface);
  if (isRouter(device)) return runRouterCommand(device, command, state, mode);
  return { output: 'Unknown simulated device.', status: 'error' };
}

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
    return 'The PC address is valid for 192.168.20.0/24, but the switchport is still in VLAN 10. That keeps the host away from its default gateway.';
  }
  if (!health.branchLanAdvertised) {
    return 'Layer 2 is fixed. The remaining issue is routing: HQ-R1 still lacks an OSPF route back to 192.168.20.0/24.';
  }
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
    scene.background = new THREE.Color(0x080d0e);
    scene.fog = new THREE.Fog(0x080d0e, 12, 30);

    const camera = new THREE.PerspectiveCamera(66, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 1.62, 6.2);
    camera.rotation.order = 'YXZ';

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x303433, roughness: 0.78, metalness: 0.08 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x141a1b, roughness: 0.65, metalness: 0.02 });
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x1d2426, roughness: 0.42, metalness: 0.58 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x30393b, roughness: 0.38, metalness: 0.5 });
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x4d4035, roughness: 0.5, metalness: 0.12 });
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x071114,
      emissive: 0x0b4f5d,
      emissiveIntensity: 0.65,
      roughness: 0.2,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xa8d8dc,
      transparent: true,
      opacity: 0.18,
      roughness: 0.08,
      transmission: 0.25,
      metalness: 0,
    });
    const amberMat = new THREE.MeshStandardMaterial({
      color: 0xffb238,
      emissive: 0xff8a00,
      emissiveIntensity: 1.1,
    });
    const greenMat = new THREE.MeshStandardMaterial({
      color: 0x42f58a,
      emissive: 0x20d86a,
      emissiveIntensity: 1.2,
    });
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xff4f5f,
      emissive: 0xff2238,
      emissiveIntensity: 1.1,
    });
    const blueMat = new THREE.MeshStandardMaterial({
      color: 0x4bb6ff,
      emissive: 0x1d82c3,
      emissiveIntensity: 0.8,
    });

    const addBox = (
      size: [number, number, number],
      position: [number, number, number],
      material: THREE.Material,
      castShadow = true,
      receiveShadow = true,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      scene.add(mesh);
      return mesh;
    };

    addBox([14, 0.18, 18], [0, -0.09, 0], floorMat, false, true);
    addBox([14, 5, 0.24], [0, 2.45, -8.2], wallMat, false, true);
    addBox([0.24, 5, 18], [-7.1, 2.45, 0], wallMat, false, true);
    addBox([0.24, 5, 18], [7.1, 2.45, 0], wallMat, false, true);
    addBox([14, 0.16, 18], [0, 4.95, 0], wallMat, false, true);
    addBox([7.4, 2.4, 0.08], [0, 2.4, 7.6], glassMat, false, false);

    const grid = new THREE.GridHelper(13.5, 18, 0x415154, 0x252d2f);
    grid.position.y = 0.015;
    scene.add(grid);

    const hemi = new THREE.HemisphereLight(0xb8eef4, 0x15100d, 1.1);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xc6f5ff, 2.2);
    keyLight.position.set(1.5, 6, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);

    const accentLight = new THREE.PointLight(0x19d3b5, 2.2, 9);
    accentLight.position.set(-3.2, 2.7, -3);
    scene.add(accentLight);

    const warningLight = new THREE.PointLight(0xff9c3d, 1.3, 6);
    warningLight.position.set(3.4, 2.3, -3.6);
    scene.add(warningLight);

    addBox([3.8, 0.18, 0.2], [0, 3.35, -8.04], blueMat, false, false);
    addBox([2.4, 0.18, 0.2], [-3.1, 3.35, -8.04], amberMat, false, false);
    addBox([2.2, 0.18, 0.2], [3.2, 3.35, -8.04], greenMat, false, false);

    const issueLight = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), redMat);
    issueLight.position.set(-4.46, 2.02, -3.25);
    scene.add(issueLight);

    const ospfLight = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), amberMat);
    ospfLight.position.set(4.46, 2.02, -3.25);
    scene.add(ospfLight);

    const createRack = (x: number, z: number, labelColor: THREE.Material) => {
      addBox([1.34, 3.1, 0.94], [x, 1.55, z], rackMat);
      addBox([1.12, 0.18, 0.84], [x, 2.72, z - 0.03], metalMat);
      addBox([1.12, 0.18, 0.84], [x, 2.27, z - 0.03], metalMat);
      addBox([1.12, 0.18, 0.84], [x, 1.82, z - 0.03], metalMat);
      addBox([1.12, 0.18, 0.84], [x, 1.37, z - 0.03], metalMat);
      addBox([0.92, 0.06, 0.05], [x, 2.84, z - 0.51], labelColor, false, false);
      addBox([0.92, 0.06, 0.05], [x, 1.49, z - 0.51], labelColor, false, false);

      for (let i = 0; i < 6; i += 1) {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), greenMat);
        light.position.set(x - 0.46 + i * 0.18, 2.27, z - 0.51);
        scene.add(light);
      }
    };

    createRack(-4.6, -3.2, amberMat);
    createRack(4.6, -3.2, greenMat);
    createRack(0, -2.5, blueMat);

    addBox([3.4, 0.22, 1.28], [0, 0.78, -5.2], deskMat);
    addBox([0.18, 1.35, 1.08], [-1.45, 0.08, -5.2], deskMat);
    addBox([0.18, 1.35, 1.08], [1.45, 0.08, -5.2], deskMat);
    const monitor = addBox([1.34, 0.82, 0.08], [0, 1.48, -5.72], screenMat, true, false);
    monitor.rotation.x = -0.06;
    addBox([0.9, 0.08, 0.36], [0, 0.96, -4.7], metalMat);
    addBox([0.8, 0.04, 0.22], [0, 1.04, -4.58], screenMat, true, false);

    const chairMat = new THREE.MeshStandardMaterial({ color: 0x252224, roughness: 0.55, metalness: 0.2 });
    addBox([0.88, 0.16, 0.84], [0, 0.53, -3.72], chairMat);
    addBox([0.88, 1.0, 0.12], [0, 1.07, -3.32], chairMat);

    const curves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-4.6, 2.3, -2.72),
        new THREE.Vector3(-3.2, 2.45, -1.8),
        new THREE.Vector3(0, 2.25, -2.0),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 2.15, -2.0),
        new THREE.Vector3(2.8, 2.45, -1.8),
        new THREE.Vector3(4.6, 2.3, -2.72),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-4.6, 1.45, -2.72),
        new THREE.Vector3(-3.4, 1.15, -4.2),
        new THREE.Vector3(0, 1.12, -4.72),
      ]),
    ];

    curves.forEach((curve, index) => {
      const cableMat = new THREE.MeshStandardMaterial({
        color: index === 0 ? 0xf2be4b : index === 1 ? 0x3fb1d4 : 0x55d687,
        roughness: 0.35,
        metalness: 0.05,
      });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 8, false), cableMat);
      tube.castShadow = true;
      scene.add(tube);
    });

    const packet = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), greenMat);
    scene.add(packet);

    const consoleTarget = new THREE.Vector3(0, 0, -4.75);
    const keys = new Set<string>();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let yaw = 0;
    let pitch = 0;
    let frameId = 0;

    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
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

    const onCanvasClick = () => {
      if (!statusRef.current.consoleOpen) {
        void renderer.domElement.requestPointerLock?.();
      }
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('click', onCanvasClick);

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
        camera.position.addScaledVector(move, speed * delta);
        camera.position.x = THREE.MathUtils.clamp(camera.position.x, -5.9, 5.9);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, -6.8, 6.9);
      }
      camera.position.y = 1.62;
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      mount.dataset.camera = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
      mount.dataset.ready = 'true';

      const flatDistance = Math.hypot(camera.position.x - consoleTarget.x, camera.position.z - consoleTarget.z);
      setNearConsole(flatDistance < 2.35);

      issueLight.material = health.accessVlanOk ? greenMat : redMat;
      ospfLight.material = health.branchLanAdvertised ? greenMat : amberMat;
      warningLight.color.set(health.endToEnd ? 0x34f083 : 0xff9c3d);
      warningLight.intensity = health.endToEnd ? 0.9 : 1.5;

      const packetCurve = health.hqReturnRoute ? curves[1] : health.gatewayReachable ? curves[0] : curves[2];
      const t = (elapsed * (health.endToEnd ? 0.22 : 0.12)) % 1;
      packet.position.copy(packetCurve.getPointAt(t));
      packet.visible = health.gatewayReachable || health.endToEnd;
      packet.scale.setScalar(health.endToEnd ? 1.1 + Math.sin(elapsed * 7) * 0.16 : 0.85);

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('click', onCanvasClick);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
        }
      });
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
        The PC address is valid. The failure is that Fa0/3 is in VLAN {state.branchAccessVlan}, so the
        host is not actually attached to the 192.168.20.0/24 broadcast domain.
      </p>
    </div>
  );
}

function TerminalPanel({
  activeDevice,
  setActiveDevice,
  state,
  setState,
}: {
  activeDevice: DeviceId;
  setActiveDevice: (device: DeviceId) => void;
  state: SimState;
  setState: Dispatch<SetStateAction<SimState>>;
}) {
  const [command, setCommand] = useState('');
  const [mode, setMode] = useState<TerminalMode>('exec');
  const [currentInterface, setCurrentInterface] = useState<string | null>(null);
  const [history, setHistory] = useState<TerminalEntry[]>(starterHistory);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  const prompt = promptFor(activeDevice, mode);

  const changeDevice = (device: DeviceId) => {
    setActiveDevice(device);
    setMode('exec');
    setCurrentInterface(null);
    setHistory((items) => [
      ...items,
      {
        prompt: 'console',
        command: `connect ${deviceLabels[device]}`,
        output: `Out-of-band console attached to ${deviceLabels[device]} (${deviceKinds[device]}).`,
        status: 'info',
      },
    ]);
  };

  const submitCommand = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;

    if (normalizeCommand(trimmed) === 'clear') {
      setHistory([]);
      setCommand('');
      return;
    }

    const result = runCommand(activeDevice, trimmed, state, mode, currentInterface);
    const nextState = result.state ?? state;
    setState(nextState);
    if (result.nextMode) setMode(result.nextMode);
    if ('nextInterface' in result) setCurrentInterface(result.nextInterface ?? null);
    setHistory((items) => [
      ...items,
      {
        prompt,
        command: trimmed,
        output: result.output,
        status: result.status ?? 'ok',
      },
    ]);
    setCommand('');
  };

  return (
    <div className="terminal-panel">
      <div className="device-bar" aria-label="Console device selector">
        {(Object.keys(deviceLabels) as DeviceId[]).map((device) => (
          <Button
            key={device}
            type="button"
            variant={activeDevice === device ? 'default' : 'secondary'}
            size="sm"
            onClick={() => changeDevice(device)}
          >
            {isRouter(device) ? <Network aria-hidden="true" /> : device === 'br-sw1' ? <Cable aria-hidden="true" /> : <Cpu aria-hidden="true" />}
            {deviceLabels[device]}
          </Button>
        ))}
      </div>

      <div className="terminal-output" ref={scrollRef} aria-live="polite">
        {history.map((item, index) => (
          <div key={`${item.prompt}-${item.command}-${index}`} className={`terminal-entry ${item.status}`}>
            <div className="terminal-command">
              <span>{item.prompt}</span>
              <strong>{item.command}</strong>
            </div>
            {item.output ? <pre>{item.output}</pre> : null}
          </div>
        ))}
      </div>

      <form className="terminal-form" onSubmit={submitCommand}>
        <label htmlFor="terminal-command">{prompt}</label>
        <input
          id="terminal-command"
          value={command}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Type a command"
        />
        <Button type="submit" size="icon-lg" aria-label="Run command">
          <Play aria-hidden="true" />
        </Button>
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
  const vlanFixed = isVlanFixed(state);
  const ospfFixed = hasBranchLanOspf(state);

  return (
    <div className="diff-panel">
      <div className="panel-heading">
        <Command aria-hidden="true" />
        <div>
          <h2>Running Diff</h2>
          <p>Only confirmed simulator changes appear here.</p>
        </div>
      </div>

      <pre className="diff-output">
        {!vlanFixed && !ospfFixed
          ? '# No approved changes yet'
          : [
              vlanFixed ? '- switchport access vlan 10' : null,
              vlanFixed ? '+ switchport access vlan 20' : null,
              ospfFixed ? '+ network 192.168.20.0 0.0.0.255 area 0' : null,
            ]
              .filter(Boolean)
              .join('\n')}
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
  const openConsole = useCallback(() => setConsoleOpen(true), []);

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
