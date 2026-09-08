import { Fragment } from 'react';
import { ArrowRight, Cable, Check, CircleAlert, Cpu, Map, Network, Server, X } from 'lucide-react';
import { routeHealth, topologyLinks } from './network-simulator';
import type { DeviceId, SimState, TopologyLink } from './network-simulator';

const deviceIcons = { pc: Cpu, switch: Cable, router: Network, server: Server };

function Connection({ link }: { link: TopologyLink }) {
  const StatusIcon = link.status === 'up' ? Check : link.status === 'down' ? X : CircleAlert;
  return (
    <div className={`topology-connection connection-${link.status}`} data-link-id={link.id} data-status={link.status} aria-label={`${link.from} ${link.fromPort} to ${link.to} ${link.toPort}: ${link.label}. ${link.detail}`} title={link.detail}>
      <div className="connection-ports"><code>{link.fromPort}</code><code>{link.toPort}</code></div>
      <div className="connection-line" aria-hidden="true"><StatusIcon /></div>
      <span className="connection-label">{link.label}</span>
    </div>
  );
}

export function TopologyView({ state, activeDevice, onSelectDevice }: { state: SimState; activeDevice: DeviceId; onSelectDevice: (device: DeviceId) => void }) {
  const health = routeHealth(state);
  const links = topologyLinks(state);
  const devices: { id: DeviceId | 'hq-server'; label: string; role: string; kind: keyof typeof deviceIcons; details: [string, string][] }[] = [
    { id: 'branch-pc', label: 'Branch PC', role: 'Workstation', kind: 'pc', details: [['IP', '192.168.20.45/24'], ['GW', '192.168.20.1']] },
    { id: 'br-sw1', label: 'BR-SW1', role: 'Access switch', kind: 'switch', details: [[state.cablePort?.replace('FastEthernet','Fa')??'PP-03', state.cablePort===null?'Unplugged':state.cablePort==='console'?'Serial only':`VLAN ${state.portVlans[state.cablePort]}`], ['Fa0/1', `VLAN ${state.portVlans['FastEthernet0/1']}`]] },
    { id: 'br-r1', label: 'BR-R1', role: 'Branch router', kind: 'router', details: [['LAN', '192.168.20.1'], ['WAN', '10.0.0.2']] },
    { id: 'hq-r1', label: 'HQ-R1', role: 'HQ router', kind: 'router', details: [['WAN', '10.0.0.1'], ['LAN', '10.10.10.1']] },
    { id: 'hq-server', label: 'HQ Server', role: 'Intranet', kind: 'server', details: [['IP', '10.10.10.10/24'], ['GW', '10.10.10.1']] },
  ];
  const issues = links.filter((link) => link.status !== 'up');
  return (
    <section className="topology-panel" aria-labelledby="topology-title">
      <header className="topology-heading">
        <div className="panel-heading"><Map aria-hidden="true" /><h2 id="topology-title">Live Topology</h2></div>
        <output className={`topology-path-status ${health.endToEnd ? 'path-ready' : 'path-blocked'}`}>
          {health.endToEnd ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          Branch to HQ: {health.endToEnd ? 'reachable' : 'blocked'}
        </output>
      </header>

      <figure className="topology-diagram" aria-label="Branch to HQ topology">
        {devices.map((device, index) => {
          const Icon = deviceIcons[device.kind];
          const content = <>
            <div className="topology-device-heading"><Icon aria-hidden="true" /><div><strong>{device.label}</strong><span>{device.role}</span></div></div>
            <dl>{device.details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </>;
          return (
            <Fragment key={device.id}>
              {device.id === 'hq-server'
                ? <div className="topology-device" data-node-id={device.id}>{content}</div>
                : <button type="button" className="topology-device" data-node-id={device.id} aria-label={`Connect to ${device.label}`} aria-pressed={activeDevice === device.id} title={`Open ${device.label} console`} onClick={() => onSelectDevice(device.id as DeviceId)}>{content}</button>}
              {links[index] ? <Connection link={links[index]} /> : null}
            </Fragment>
          );
        })}
      </figure>

      <div className="topology-routes" aria-label="Learned OSPF routes">
        <div className={`topology-route ${health.hqRoute ? 'route-present' : 'route-missing'}`} data-route="hq" data-status={health.hqRoute ? 'learned' : 'missing'}>
          <span>{health.hqRoute ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />} BR-R1 <ArrowRight aria-hidden="true" /> <code>10.10.10.0/24</code></span><strong>{health.hqRoute ? 'Learned via OSPF' : 'Route missing'}</strong>
        </div>
        <div className={`topology-route ${health.hqReturnRoute ? 'route-present' : 'route-missing'}`} data-route="branch" data-status={health.hqReturnRoute ? 'learned' : 'missing'}>
          <span>{health.hqReturnRoute ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />} HQ-R1 <ArrowRight aria-hidden="true" /> <code>192.168.20.0/24</code></span><strong>{health.hqReturnRoute ? 'Learned via OSPF' : 'Return route missing'}</strong>
        </div>
      </div>

      <ul className="topology-issues" aria-label="Link status">{issues.length > 0
        ? issues.map((link) => <li key={link.id}><CircleAlert aria-hidden="true" /><span><strong>{link.from} to {link.to}:</strong> {link.detail}</span></li>)
        : <li className="path-ready"><Check aria-hidden="true" /><span>All links forwarding</span></li>}
      </ul>
    </section>
  );
}
