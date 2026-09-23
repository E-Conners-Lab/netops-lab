# Security Policy

## Scope

NetOps Lab is an educational, deterministic networking simulator. It does not
connect to physical network devices, run entered commands on the host, or use
the simulated CLI to execute shell commands.

For local Docker use, progress is stored only in the mounted `/data` volume.
Do not publish that volume or any `.wrangler` state directory.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this
repository. Do not include proof-of-concept exploit details in a public issue.

## Supported version

Security fixes are made against the latest version on the `main` branch.
