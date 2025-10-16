# Pterodactyl Allocation → UDM Port Forward Sync

This service keeps a UniFi Dream Machine (UDM) firewall in sync with allocation changes made in a Pterodactyl panel. Whenever an allocation is created or deleted on the configured Pterodactyl node, the script creates or removes the corresponding port forwarding rule on the UDM.

The implementation periodically polls the Pterodactyl Application API for allocation data, compares it with the forwards that already exist on the UDM, and applies only the differences. Each managed forward is tagged with a configurable prefix so that the synchroniser leaves any manually created rules untouched.

## Configuration

Create a `.env` file (you can copy `.env.example`) and provide the following values:

| Variable | Description |
| --- | --- |
| `PTERODACTYL_URL` | Base URL of your Pterodactyl panel (e.g. `https://panel.example.com`). |
| `PTERODACTYL_API_KEY` | Application API key with permissions to list allocations for the target node. |
| `PTERODACTYL_NODE_ID` | Numeric identifier of the node to watch for allocation changes. |
| `SYNC_INTERVAL_SECONDS` | Optional polling interval; defaults to 30 seconds. |
| `UDM_URL` | Base URL of the UDM (e.g. `https://192.168.1.1`). |
| `UDM_USERNAME` | UniFi account username used to log in to the UDM. |
| `UDM_PASSWORD` | UniFi account password used to log in to the UDM. |
| `UDM_SITE` | Optional site name; defaults to `default`. |
| `UDM_ALLOW_SELF_SIGNED` | Set to `true` when the UDM uses a self-signed certificate. |
| `TARGET_IP_DEFAULT` | Internal IP to forward traffic to when no specific mapping is provided. |
| `TARGET_IP_MAP` | Optional JSON map of `{ "publicIp": "internalIp" }` for multi-IP deployments. |
| `UDM_WAN_IP` | WAN IP to bind the forward to (`any` to match all). |
| `PORT_FORWARD_SOURCE` / `PORT_FORWARD_DESTINATION` | Source/destination match values for the rule (`any` by default). |
| `PORT_FORWARD_PROTOCOL` | `tcp`, `udp`, or `tcp_udp`. Translates to UniFi's `tcp`, `udp`, or `both`. |
| `PORT_FORWARD_NAME_PREFIX` | Prefix used to tag managed port forwards; defaults to `ptero-alloc-`. |
| `DEBUG` | Set to `true` for verbose debug logging. |

> **Note**: Either `TARGET_IP_DEFAULT` or at least one entry in `TARGET_IP_MAP` must be defined so the service knows which internal host to forward to.

## Local Development

```bash
npm install
npm run build
npm start
# Run unit tests
npm test
```

Use `npm run dev` for an on-demand TypeScript run without compiling first.

## Docker

Build and run the synchroniser with Docker:

```bash
docker build -t ptero-udm-sync .
docker run --rm \
  --env-file .env \
  ptero-udm-sync
```

The image is based on `node:20-alpine` and starts the compiled TypeScript entry point (`dist/main.js`).

## Behaviour

- The synchroniser polls the Pterodactyl node at the configured interval and creates a deterministic forward name (`<PORT_FORWARD_NAME_PREFIX><allocationId>`).
- Existing UniFi rules that do not use the prefix are ignored.
- When an allocation disappears, the corresponding forward is removed.
- If the internal IP, ports, or metadata of a managed forward drift away from the desired state, the rule is updated in-place.

The service keeps a single in-memory loop running; it does not persist state between restarts. The UniFi API remains the source of truth for the currently applied forwards.
