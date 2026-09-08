import type {
  DeviceId,
  MissionId,
  SimState,
  TerminalEntry,
  TerminalMode,
} from './network-simulator';

export type TerminalSession = {
  mode: TerminalMode;
  currentInterface: string | null;
  command: string;
  history: TerminalEntry[];
  recalled: number | null;
  draft: string;
};
export type Sessions = Record<DeviceId, TerminalSession>;
export type MissionProgress = {
  state: SimState;
  sessions: Sessions;
  activeDevice: DeviceId;
  guided: boolean;
  hints: Record<string, number>;
  started: boolean;
};
export type LabProgress = {
  version: 1;
  activeMission: MissionId;
  missions: Record<MissionId, MissionProgress>;
};
export const deviceIds: DeviceId[] = ['branch-pc', 'br-sw1', 'br-r1', 'hq-r1'];

export function newMissionProgress(
  state: SimState,
  history: TerminalEntry[] = [],
): MissionProgress {
  return {
    state,
    activeDevice: 'branch-pc',
    guided: true,
    hints: {},
    started: false,
    sessions: Object.fromEntries(
      deviceIds.map((id) => [
        id,
        {
          mode: 'exec',
          currentInterface: null,
          command: '',
          history: structuredClone(history),
          recalled: null,
          draft: '',
        },
      ]),
    ) as Sessions,
  };
}

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (v: unknown, max = 3000): v is string =>
  typeof v === 'string' && v.length <= max;
const oneOf = (v: unknown, options: readonly string[]): v is string =>
  typeof v === 'string' && options.includes(v);
const array = (
  v: unknown,
  test: (item: unknown) => boolean,
  max = 100,
): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(test);
const integer = (v: unknown, min = 0, max = 1000000): v is number =>
  Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const ip = (v: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(v) &&
  v.split('.').every((part) => Number(part) <= 255);
const network = (v: unknown) => {
  if (!short(v, 100)) return false;
  const a = v.split(' ');
  return (
    a.length === 4 &&
    ip(a[0]) &&
    ip(a[1]) &&
    a[2] === 'area' &&
    /^\d+$/.test(a[3]) &&
    Number(a[3]) <= 4294967295
  );
};
const ifaces: Record<DeviceId, string[]> = {
  'branch-pc': [],
  'br-sw1': ['FastEthernet0/1', 'FastEthernet0/2', 'FastEthernet0/3'],
  'br-r1': ['GigabitEthernet0/0', 'GigabitEthernet0/1'],
  'hq-r1': ['GigabitEthernet0/0', 'GigabitEthernet0/1'],
};
const interfaceKeys = deviceIds.flatMap((id) =>
  ifaces[id].map((iface) => `${id}:${iface}`),
);

// Saved checkpoints cross a trust boundary. Reject malformed/foreign versions instead of
// merging arbitrary objects into live simulator state or silently replacing a newer save.
export function validProgress(value: unknown): value is LabProgress {
  if (
    !record(value) ||
    value.version !== 1 ||
    !oneOf(value.activeMission, ['branch', 'cabling']) ||
    !record(value.missions)
  )
    return false;
  for (const id of ['branch', 'cabling']) {
    const mission = value.missions[id];
    if (
      !record(mission) ||
      !record(mission.state) ||
      !record(mission.sessions) ||
      typeof mission.guided !== 'boolean' ||
      typeof mission.started !== 'boolean' ||
      !deviceIds.includes(mission.activeDevice as DeviceId) ||
      !record(mission.hints)
    )
      return false;
    if (
      Object.entries(mission.hints).length > 40 ||
      !Object.entries(mission.hints).every(
        ([k, v]) => /^[a-zA-Z0-9:/-]{1,100}$/.test(k) && integer(v, 0, 2),
      )
    )
      return false;
    const s = mission.state;
    if (
      s.missionId !== id ||
      !(
        s.cablePort === null ||
        oneOf(s.cablePort, ['console', 'FastEthernet0/2', 'FastEthernet0/3'])
      ) ||
      !integer(s.branchAccessVlan, 1, 4094)
    )
      return false;
    if (
      !array(s.brOspfNetworks, network) ||
      !array(s.hqOspfNetworks, network) ||
      !array(s.shutdownInterfaces, (v) => oneOf(v, interfaceKeys), 7)
    )
      return false;
    if (
      !record(s.portModes) ||
      !record(s.portVlans) ||
      !ifaces['br-sw1'].every(
        (key) =>
          oneOf((s.portModes as Record<string, unknown>)[key], [
            'access',
            'trunk',
          ]) && integer((s.portVlans as Record<string, unknown>)[key], 1, 4094),
      ) ||
      s.portVlans['FastEthernet0/3'] !== s.branchAccessVlan
    )
      return false;
    if (
      !record(s.descriptions) ||
      !Object.entries(s.descriptions).every(
        ([k, v]) => interfaceKeys.includes(k) && short(v, 240),
      ) ||
      !record(s.startupConfigs) ||
      !Object.entries(s.startupConfigs).every(
        ([k, v]) => deviceIds.includes(k as DeviceId) && short(v, 30000),
      )
    )
      return false;
    if (
      typeof s.verifiedBranchToHq !== 'boolean' ||
      typeof s.viewedSubnet !== 'boolean' ||
      !integer(s.badCommands) ||
      !integer(s.usedShowCommands) ||
      !array(
        s.observations,
        (v) =>
          oneOf(v, [
            'pc-address',
            'pc-route',
            'access-vlan',
            'gateway-test',
            'return-route',
            'physical-port',
          ]),
        6,
      )
    )
      return false;
    for (const device of deviceIds) {
      const session = mission.sessions[device];
      if (
        !record(session) ||
        !oneOf(session.mode, [
          'exec',
          'user-exec',
          'config',
          'interface',
          'router-ospf',
        ]) ||
        !short(session.command, 1000) ||
        !short(session.draft, 1000)
      )
        return false;
      if (device === 'branch-pc' && session.mode !== 'exec') return false;
      if (
        session.currentInterface !== null &&
        !oneOf(session.currentInterface, ifaces[device])
      )
        return false;
      if (session.mode === 'interface' && session.currentInterface === null)
        return false;
      if (device === 'br-sw1' && session.mode === 'router-ospf') return false;
      if (
        !array(
          session.history,
          (e) =>
            record(e) &&
            short(e.prompt, 100) &&
            short(e.command, 1000) &&
            short(e.output, 6000) &&
            oneOf(e.status, ['ok', 'error', 'info']),
          40,
        )
      )
        return false;
      if (session.recalled !== null && !integer(session.recalled, 0, 40))
        return false;
    }
  }
  return true;
}

export function checkpoint(progress: LabProgress): LabProgress {
  const copy = structuredClone(progress);
  for (const mission of Object.values(copy.missions))
    for (const session of Object.values(mission.sessions)) {
      session.history = session.history
        .slice(-40)
        .map((entry) => ({
          ...entry,
          output: entry.output.slice(0, 6000),
          command: entry.command.slice(0, 1000),
        }));
      session.command = session.command.slice(0, 1000);
      session.draft = session.draft.slice(0, 1000);
      session.recalled = null;
    }
  return copy;
}
