# luci-app-hostmon

A per-device traffic monitor for OpenWrt's LuCI.

It adds a **Monitor** button next to **Reserve IP** in the **DHCP Leases** table
on **Status → Overview**. The button opens **Status → Host Monitor** for that
device. The page also has a device picker of its own.

## What the page shows

| Section | Contents |
|---|---|
| **Live traffic** | Download and upload rate through the router, as a graph (2-second samples, last 5 minutes), plus current and peak rates |
| **Device** | Hostname, IP, MAC, the DHCP lease or static reservation, the interface and ARP state, the bridge port it was last seen on, and addrwatch sightings. Warns if other MACs have used the same IP |
| **Current connections** | The top remote addresses and every live connection (from conntrack), with direction, ports, a guessed service (HTTPS, MQTT, Tuya, RTSP, Modbus, …), state and bytes. Filterable |
| **Usage this period** | nlbwmon totals and top protocols/ports, if nlbwmon is installed |
| **Security** | CrowdSec decisions for the address and Snort 3 alerts involving it, if those are installed |

## How it works

There's no daemon and no change to your firewall rules. A small rpcd ucode
backend (`luci.hostmon`) answers five read-only calls:

- **`rate`:** creates a separate nftables table, `inet luci_hostmon`, with
  count-only rules (`ip saddr X counter` / `ip daddr X counter`, policy
  accept) for the device being watched. Rules for a device are removed once
  nobody has viewed it for 5 minutes. The table is deleted once nothing is
  being watched. Rules are only tidied up when the page is used, so after
  closing the page a few idle counter rules can remain until the next visit
  or a reboot. They only count; they never block.
- **`conns`:** reads `/proc/net/nf_conntrack` for the device.
- **`host`:** the lease, static lease, neighbour and bridge port, nlbwmon,
  Snort `alert_json.txt` and addrwatch entries from the system log.
- **`names`:** resolves remote addresses for the connection tables (see
  below).
- **`crowdsec`:** `cscli decisions list -a --ip X`, filtered to the address.

Addresses are validated as dotted-quad IPv4 before anything else runs.

The **Monitor** button comes from an invisible Overview include
(`view/status/include/41_hostmon.js`). It adds the button to the lease table
each time the table is redrawn, so `luci-mod-status` is never modified.

## Name resolution

With **Resolve names** ticked (the default), each remote address in the
connection tables shows a name and a tag for where the name came from. The
sources are tried in this order:

| Tag | Source |
|---|---|
| **DNS** | The name **this device** looked up, from the AdGuard Home query log. The DNS answers are decoded, so `35.156.44.172` shows as e.g. `m1.tuyaeu.com` rather than an AWS hostname |
| **DNS\*** | A name **another device** looked up for that address |
| **LAN** | A local device or router name, from DHCP leases, static leases and the router's interface addresses |
| **rDNS** | Reverse DNS (PTR) through the router's resolver. It names the *server* (e.g. `ec2-…amazonaws.com`), not necessarily the service. Lookups run in parallel with a 3 s timeout, and results, including misses, are cached for an hour in `/tmp/luci-hostmon/ptr.json` |

Addresses without a DNS-log name are retried every minute, because the device
may look the name up again later.

### AdGuard Home query log

The **DNS** and **DNS\*** names need AdGuard Home's query log **written to a
file**. AdGuard's default keeps it in memory only (`file_enabled: false`), and
its API needs your admin password. The backend finds the log directory from
`querylog.dir_path`, or `<work_dir>/data` if that is empty, using the AdGuard
config named in `/etc/config/adguardhome`.

To keep the log in RAM, and off flash, on OpenWrt:

```yaml
querylog:
  dir_path: /tmp/adguardhome-querylog
  interval: 6h
  size_memory: 20      # flush to the file every 20 queries
  file_enabled: true
```

**Two catches with the OpenWrt package,** because AdGuard runs inside a ujail
and exits with a fatal error if `dir_path` is missing:

1. **Let the jail see the directory:**
   `uci add_list adguardhome.config.jail_mount_rw=/tmp/adguardhome-querylog && uci commit adguardhome`
2. **Create the directory at every boot, before AdGuard starts.** `/tmp` is
   empty after a reboot. For example, add a small init script with
   `START=18` (AdGuard is `START=19`) that runs
   `mkdir -p /tmp/adguardhome-querylog && chown adguardhome:adguardhome /tmp/adguardhome-querylog`.

Without either of those, **AdGuard won't start, and DNS for the whole network
goes down.** Make the change with a way to roll it back.

Without AdGuard (or with the file log off), names fall back to local names and
reverse DNS.

## Limitations

- **IPv4 only.**
- **Only traffic the router handles is counted:** internet, other
  VLANs/networks and the router's own services (DNS, NTP). Traffic between
  two devices on the same network stays in the switch or Wi-Fi access point
  and is never seen.
- **Hardware and software flow offloading** let established flows bypass
  nftables, which would freeze the live graph. Offloading must be off.
- **The Monitor button is found by matching IPv4 text** in each row of the
  table with id `status_leases`. A future luci-mod-status that renames that
  table hides the button, but the page still works through its own picker.

## Install (OpenWrt 25.12, apk)

```sh
apk add --allow-untrusted ./luci-app-hostmon-1.0.0-r1.apk
```

Then log out of LuCI and back in.

## Build from source

```sh
cp -r luci-app-hostmon <sdk>/feeds/luci/applications/
cd <sdk>
./scripts/feeds install luci-app-hostmon
make package/luci-app-hostmon/compile
```

## License

Apache-2.0
