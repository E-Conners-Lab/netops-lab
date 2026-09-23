# NetOps Lab

A browser-based networking training prototype built with React, Three.js, and Vinext. Explore a network operations room, inspect a physical patch bay, and troubleshoot through a live topology and typed device consoles.

This is an educational simulator. It does not run commands on your computer or connect to physical network gear. Cisco and IOS are trademarks of Cisco Systems, Inc.; NetOps Lab is not affiliated with or endorsed by Cisco.

## Missions

- **Bring the Branch Online:** repair an access VLAN and OSPF return-route fault.
- **The Misplaced Patch Lead:** move a workstation circuit from a serial console jack to its assigned Ethernet port, then verify reachability from the workstation.

The CLI is a deterministic, mission-scoped simulator, not Cisco IOS emulation. Supported commands include token-by-token abbreviations, configuration modes, contextual help, interface status, VLANs, OSPF network statements, ping, and selected Linux networking commands. Unsupported input fails rather than being interpreted by a language model.

## Local Development

Requires Node 22.13 or newer. Install dependencies and generate the Worker configuration:

```sh
npm ci
npm run build
```

Initialize the local D1 database once:

```sh
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_confused_puff_adder.sql
```

```sh
npm run dev
```

The default preview is http://localhost:3000. The local database stays in ignored `.wrangler/state`; it is separate from hosted player saves.

## Run With Docker

Docker is the supported download-and-launch option for this prototype. It runs the app locally at http://localhost:3000 and stores progress in a named Docker volume.

```sh
git clone https://github.com/E-Conners-Lab/netops-lab.git
cd netops-lab
docker compose up --build
```

Use `Ctrl+C` to stop it. Start it again with `docker compose up`; existing progress remains. To remove the app and its local save data, run:

```sh
docker compose down --volumes
```

The container runs as an unprivileged user, exposes only port `3000`, and has no credentials or external service configuration. Review `SECURITY.md` before sharing Docker data volumes.

## Checkpoints

Each browser receives an opaque HttpOnly cookie identifying a server-backed save slot. Each mission retains its own configuration, patch position, active console, terminal context, recent history, and hints. No player account is required. Clearing the cookie loses access to that browser's slot; saves do not follow the player across browsers. Concurrent writes use revision checks to prevent silent overwrites. The most recent 40 terminal entries per device are retained in checkpoints.

Database schema is in `db/schema.ts`; generated SQL migrations are committed under `drizzle/`. Sites applies those migrations when publishing. No database schema is created during application requests.

## Verification

```sh
npm test
npx tsc --noEmit --incremental false
npx oxlint app db drizzle.config.ts tests
```

With the local server running, include the save API integration test:

```sh
NETOPS_TEST_ORIGIN=http://localhost:3000 npm test
```

The repository-wide lint command also checks the bundled UI component library, which currently contains pre-existing lint findings.

## Next Candidates

- A visual subnet allocation mission with address-planning tickets.
- Packet-path inspection for ARP, ICMP, and TCP.
- Broader switching and routing commands, backed by behavioral regression tests.
- Additional 3D physical tasks and low-end graphics settings.

These are roadmap candidates, not implemented features.

## License

Released under the [MIT License](LICENSE).
