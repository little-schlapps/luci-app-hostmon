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
backend (`luci.hostmon`) answers four read-only calls:

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
- **`crowdsec`:** `cscli decisions list -a --ip X`, filtered to the address.

Addresses are validated as dotted-quad IPv4 before anything else runs.

The **Monitor** button comes from an invisible Overview include
(`view/status/include/41_hostmon.js`). It adds the button to the lease table
each time the table is redrawn, so `luci-mod-status` is never modified.

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
