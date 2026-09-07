import type { DeviceId, SimState, TerminalMode, routeHealth } from './network-simulator';

type Health = ReturnType<typeof routeHealth>;
export type MissionGuidance = {
  id: string;
  step: number;
  title: string;
  device: DeviceId;
  objective: string;
  clue: string;
  commands: string[];
  expected: string;
  configure?: boolean;
};

export function missionGuidance(state: SimState, health: Health): MissionGuidance {
  const saw = (id: SimState['observations'][number]) => state.observations.includes(id);
  if (health.endToEnd && state.verifiedBranchToHq) return {
    id: 'complete', step: 7, title: 'Branch restored', device: 'branch-pc',
    objective: 'Your end-to-end ping succeeded. Both directions of the journey now work.',
    clue: 'VLAN 20 puts the PC and gateway in the same broadcast domain. OSPF gives HQ a route back to the branch. An IP address alone cannot solve either fault.',
    commands: [], expected: 'Ticket NOC-1047 closed. Switching, routing, and verification completed.',
  };
  if (!saw('pc-address') || !saw('pc-route')) return {
    id: 'address', step: 1, title: 'Know your starting point', device: 'branch-pc',
    objective: 'Inspect the workstation address and its default gateway before changing the network.',
    clue: 'A /24 keeps the first 24 bits for the network: 192.168.20. The remaining 8 bits identify hosts. This PC and 192.168.20.1 belong to the same IP subnet.',
    commands: ['ip addr', 'ip route'], expected: '192.168.20.45/24 on eth0; default via 192.168.20.1.',
  };
  const shut = state.shutdownInterfaces[0];
  if (shut) {
    const [device, iface] = shut.split(':');
    return { id: `shutdown-${shut}`, step: 3, title: 'Restore an interface', device: device as DeviceId,
      objective: 'An administratively disabled interface is interrupting the path.',
      clue: `${iface} is shut down. A correct VLAN or route cannot carry traffic across an interface that is disabled.`,
      configure: true, commands: ['configure terminal', `interface ${iface}`, 'no shutdown', 'end'], expected: 'The interface returns to up/up, and its physical link recovers.' };
  }
  if (!health.accessVlanOk && !saw('access-vlan')) return {
    id: 'inspect-access', step: 2, title: 'Follow the first cable', device: 'br-sw1',
    objective: 'Find the VLAN assigned to the workstation port, Fa0/3.',
    clue: 'A switch keeps VLANs in separate broadcast domains. Even hosts with matching IP subnets cannot reach each other if the switch separates them.',
    commands: ['show vlan brief', 'show interfaces FastEthernet0/3 switchport'], expected: 'Compare Fa0/3 with the gateway-facing Fa0/1. The branch design calls for access VLAN 20.',
  };
  if (!health.accessVlanOk) return {
    id: 'fix-access', step: 3, title: 'Restore the local segment', device: 'br-sw1',
    objective: 'Put the workstation port in the same VLAN as its gateway.',
    clue: `Fa0/3 currently uses ${state.portModes['FastEthernet0/3']} mode and VLAN ${state.branchAccessVlan}. This workstation needs an untagged access port in VLAN 20.`,
    configure: true, commands: ['configure terminal', 'interface FastEthernet0/3', 'switchport mode access', 'switchport access vlan 20', 'end'], expected: 'The PC-to-switch link turns healthy. Remote connectivity still needs a return route.',
  };
  if (!health.gatewayReachable) return {
    id: 'uplink', step: 3, title: 'Check the gateway uplink', device: 'br-sw1',
    objective: 'The workstation port is correct, but the gateway is still isolated.',
    clue: 'Fa0/1 connects to an untagged router interface in this lab. It must also be an access port in VLAN 20.',
    configure: true, commands: ['configure terminal', 'interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 20', 'end'], expected: 'The local path to 192.168.20.1 becomes reachable.',
  };
  if (!saw('gateway-test')) return {
    id: 'gateway', step: 4, title: 'Prove the local repair', device: 'branch-pc',
    objective: 'Test the gateway before troubleshooting the remote network.',
    clue: 'Ping uses ICMP echo requests and replies. A reply from the gateway confirms that the local segment can carry traffic in both directions.',
    commands: ['ping 192.168.20.1'], expected: 'Replies from 192.168.20.1 with no packet loss.',
  };
  if (!health.ospfNeighborFull) return {
    id: 'adjacency', step: 5, title: 'Recover the OSPF neighbor', device: 'br-r1',
    objective: 'The WAN link is up, but the routers are not exchanging routes.',
    clue: 'Both WAN interfaces need OSPF in the same area. Compare the network statements on BR-R1 and HQ-R1; the mission WAN is 10.0.0.0/30 in area 0.',
    commands: ['show ip ospf neighbor', 'show ip protocols', 'show running-config'], expected: 'A FULL neighbor after both routers use a matching WAN area.',
  };
  if (!health.hqReturnRoute && !saw('return-route')) return {
    id: 'inspect-route', step: 5, title: 'Look at the return journey', device: 'hq-r1',
    objective: 'Investigate how the HQ router would send a reply to the branch PC.',
    clue: 'A successful request is only half the journey. HQ also needs a route to the source subnet, 192.168.20.0/24.',
    commands: ['show ip route'], expected: 'The branch subnet is missing from the HQ route table.',
  };
  if (!health.branchLanAdvertised) return {
    id: 'advertise', step: 6, title: 'Give HQ a way back', device: 'br-r1',
    objective: 'Include the branch LAN in the existing OSPF process.',
    clue: 'An OSPF network statement selects local interfaces. Wildcard 0.0.0.255 matches the first three octets and allows any last octet, including BR-R1\'s 192.168.20.1.',
    configure: true, commands: ['configure terminal', 'router ospf 1', 'network 192.168.20.0 0.0.0.255 area 0', 'end'], expected: 'HQ-R1 learns 192.168.20.0/24 via OSPF. Confirm it with show ip route on HQ-R1.',
  };
  if (!health.hqRoute) return {
    id: 'hq-lan', step: 6, title: 'Restore the HQ advertisement', device: 'hq-r1',
    objective: 'The branch has a return route, but cannot learn the service subnet.',
    clue: 'The HQ LAN interface also needs to participate in OSPF. Its network is 10.10.10.0/24.',
    configure: true, commands: ['configure terminal', 'router ospf 1', 'network 10.10.10.0 0.0.0.255 area 0', 'end'], expected: 'BR-R1 learns the HQ service subnet.',
  };
  return {
    id: 'verify', step: 7, title: 'Verify from the user\'s desk', device: 'branch-pc',
    objective: 'The network looks healthy. Prove the HQ server is reachable from the original source.',
    clue: 'Testing from a router can miss a broken access segment. Use the branch workstation to verify the entire path.',
    commands: ['ping 10.10.10.10'], expected: 'A successful ping closes the ticket. ICMP reachability does not, by itself, test the web application.',
  };
}

export function guidanceCommands(guide: MissionGuidance, mode: TerminalMode) {
  if (guide.device === 'branch-pc' || !guide.commands.length) return guide.commands;
  if (!guide.configure) return guide.commands.map((command) => ['config', 'interface', 'router-ospf'].includes(mode) ? `do ${command}` : command);
  return [...(mode === 'user-exec' ? ['enable'] : mode === 'exec' ? [] : ['end']), ...guide.commands];
}
