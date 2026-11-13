# SPDX-License-Identifier: Apache-2.0
#
# LuCI per-host traffic monitor with a "Monitor" button on the DHCP leases table.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI per-host traffic monitor
LUCI_DESCRIPTION:=Live bandwidth graph, current connections, nlbwmon usage and \
	Snort/CrowdSec events for one device, opened from a Monitor button next to \
	Reserve IP in the Overview's DHCP leases table.
LUCI_DEPENDS:=+luci-base +luci-mod-status +rpcd-mod-ucode +nftables-json
LUCI_PKGARCH:=all

# Explicit version for standalone releases; luci.mk would otherwise derive
# one from the git history of the LuCI feed.
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=little-schlapps <little-schlapps@users.noreply.github.com>
# luci.mk writes these into the package metadata (it ignores PKG_MAINTAINER)
LUCI_MAINTAINER:=$(PKG_MAINTAINER)
LUCI_URL:=https://github.com/little-schlapps/luci-app-hostmon

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
