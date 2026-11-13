// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require dom';
'require rpc';
'require poll';
'require ui';

const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const callRate = rpc.declare({ object: 'luci.hostmon', method: 'rate', params: [ 'ip' ], expect: { } });
const callConns = rpc.declare({ object: 'luci.hostmon', method: 'conns', params: [ 'ip' ], expect: { } });
const callHost = rpc.declare({ object: 'luci.hostmon', method: 'host', params: [ 'ip' ], expect: { } });
const callCrowdsec = rpc.declare({ object: 'luci.hostmon', method: 'crowdsec', params: [ 'ip' ], expect: { } });

const SAMPLES = 150;		// 2 s apart: 5 minutes of history
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const SERVICES = {
	'tcp:22': 'SSH', 'tcp:53': 'DNS', 'udp:53': 'DNS', 'tcp:80': 'HTTP', 'tcp:443': 'HTTPS', 'udp:443': 'QUIC',
	'udp:123': 'NTP', 'udp:67': 'DHCP', 'udp:68': 'DHCP', 'tcp:853': 'DNS-over-TLS', 'udp:853': 'DNS-over-QUIC',
	'tcp:554': 'RTSP', 'tcp:1883': 'MQTT', 'tcp:8883': 'MQTT-TLS', 'tcp:8886': 'MQTT-TLS (Tuya)',
	'tcp:6668': 'Tuya local', 'udp:6666': 'Tuya discovery', 'udp:6667': 'Tuya discovery',
	'tcp:5223': 'Apple/Samsung push', 'tcp:5228': 'Google push', 'udp:1900': 'SSDP', 'udp:5353': 'mDNS',
	'tcp:3478': 'STUN', 'udp:3478': 'STUN', 'udp:19302': 'STUN (Google)', 'tcp:502': 'Modbus/TCP',
	'tcp:8080': 'HTTP-alt', 'tcp:8443': 'HTTPS-alt', 'udp:51820': 'WireGuard', 'tcp:993': 'IMAPS', 'tcp:587': 'SMTP-submission'
};

function svc(proto, port) {
	return SERVICES['%s:%d'.format(String(proto).toLowerCase(), port)] || null;
}

function fmtBytes(n) {
	return '%1024.1mB'.format(n || 0);
}

function fmtRate(bps) {
	return '%1000.1mbit/s'.format((bps || 0) * 8);
}

function table(headers, rows, empty) {
	const t = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, headers.map(h => E('th', { 'class': 'th left' }, [ h ])))
	]);

	if (!rows.length)
		t.appendChild(E('tr', { 'class': 'tr placeholder' }, [ E('td', { 'class': 'td', 'colspan': headers.length }, [ E('em', [ empty ]) ]) ]));

	rows.forEach(r => t.appendChild(E('tr', { 'class': 'tr' }, r.map(c => E('td', { 'class': 'td left' }, [ c ])))));
	return t;
}

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '33%' }, [ label ]),
		E('td', { 'class': 'td left' }, [ value ])
	]);
}

// ------------------------------------------------------------------ live graph

function drawGraph(svg, samples) {
	const W = 1000, H = 220, PAD = 4;
	let max = 1;

	samples.forEach(s => { max = Math.max(max, s.rx, s.tx); });
	max *= 1.15;

	const x = i => (W * i / (SAMPLES - 1));
	const y = v => H - PAD - (H - 2 * PAD) * v / max;
	const off = SAMPLES - samples.length;
	const path = key => samples.map((s, i) => '%s%.1f,%.1f'.format(i ? 'L' : 'M', x(off + i), y(s[key]))).join('');
	const area = key => samples.length ? path(key) + 'L%.1f,%dL%.1f,%dZ'.format(x(SAMPLES - 1), H, x(off), H) : '';

	let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" preserveAspectRatio="none" width="100%%" height="%d" style="display:block">'.format(W, H, H);

	[ 0.25, 0.5, 0.75 ].forEach(f => {
		s += '<line x1="0" x2="%d" y1="%.1f" y2="%.1f" stroke="currentColor" stroke-opacity="0.15" stroke-dasharray="4 4"/>'.format(W, y(max * f), y(max * f));
	});

	if (samples.length) {
		s += '<path d="%s" fill="#2f7ed8" fill-opacity="0.25" stroke="none"/>'.format(area('rx'));
		s += '<path d="%s" fill="none" stroke="#2f7ed8" stroke-width="2" vector-effect="non-scaling-stroke"/>'.format(path('rx'));
		s += '<path d="%s" fill="#e8833a" fill-opacity="0.2" stroke="none"/>'.format(area('tx'));
		s += '<path d="%s" fill="none" stroke="#e8833a" stroke-width="2" vector-effect="non-scaling-stroke"/>'.format(path('tx'));
	}

	s += '</svg>';

	// Axis labels as HTML so they don't stretch with the non-uniform SVG scaling.
	const labels = [ 0.25, 0.5, 0.75 ].map(f =>
		'<span style="position:absolute;left:6px;top:%.1f%%;font-size:12px;opacity:.6;transform:translateY(-110%%)">%s</span>'
			.format(100 * y(max * f) / H, fmtRate(max * f)));

	svg.innerHTML = s + labels.join('');
}

// ------------------------------------------------------------------ sections

function renderInfo(h, ip) {
	const l = h.lease || {}, st = h.static_lease, n = h.neigh, p = h.port, aw = h.addrwatch || {};
	const mac = l.mac || (n && n.mac) || null;

	return E('table', { 'class': 'table' }, [
		row(_('Hostname'), l.hostname || (st && st.name) || E('em', [ _('none sent') ])),
		row(_('IPv4 address'), ip),
		row(_('MAC address'), mac || '-'),
		row(_('DHCP lease'), l.expires ? (st ? _('static reservation (%s)').format(st.name || '-') : _('dynamic, expires %s').format(new Date(l.expires * 1000).toLocaleString())) : (st ? _('static reservation') : _('no active lease'))),
		row(_('Seen on'), [ n ? '%s (%s)'.format(n.dev, n.state) : '-', p ? _(' · bridge port %s (last frame %ss ago)').format(p.port, p.ageing) : '' ]),
		row(_('addrwatch sightings'), aw.count ? _('%d (first %s, last %s)').format(aw.count, aw.first, aw.last) : '-'),
		(aw.other_macs && aw.other_macs.length)
			? row(_('Other MACs seen on this IP'), E('span', { 'class': 'label warning' }, [ aw.other_macs.join(', ') ]))
			: E([])
	]);
}

function renderConns(c, filter) {
	const f = (filter || '').toLowerCase();
	const list = (c.conns || []).filter(x => !f || [ x.remote, x.remote_port, x.proto, svc(x.proto, x.remote_port) || '' ].join(' ').toLowerCase().indexOf(f) >= 0);

	const remotes = {};
	(c.conns || []).forEach(x => {
		const r = remotes[x.remote] = remotes[x.remote] || { ip: x.remote, conns: 0, rx: 0, tx: 0, ports: {} };
		r.conns++; r.rx += x.rx_bytes; r.tx += x.tx_bytes;
		r.ports['%s/%d'.format(x.proto, x.remote_port)] = true;
	});

	const top = Object.values(remotes).sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx)).slice(0, 10);

	return E('div', [
		E('p', [ _('%d active connections (%d shown).').format(c.total || 0, list.length > 100 ? 100 : list.length) ]),
		E('div', { 'style': 'display:flex;gap:2em;flex-wrap:wrap' }, [
			E('div', { 'style': 'flex:1;min-width:320px' }, [
				E('h4', [ _('Top remote addresses (current connections)') ]),
				table([ _('Address'), _('Ports'), _('Conns'), _('Down'), _('Up') ],
					top.map(r => [ r.ip, Object.keys(r.ports).slice(0, 4).join(', '), String(r.conns), fmtBytes(r.rx), fmtBytes(r.tx) ]),
					_('No connections'))
			])
		]),
		E('h4', [ _('Connections') ]),
		table([ _('Dir'), _('Proto'), _('Local port'), _('Remote'), _('Service'), _('State'), _('Down'), _('Up') ],
			list.slice(0, 100).map(x => [
				x.direction == 'out' ? '→' : '←', x.proto, String(x.local_port || '-'),
				'%s:%s'.format(x.remote, x.remote_port || '-'),
				svc(x.proto, x.remote_port) || svc(x.proto, x.local_port) || '-',
				x.state || (x.assured ? _('assured') : _('unreplied')),
				fmtBytes(x.rx_bytes), fmtBytes(x.tx_bytes)
			]),
			_('No active connections'))
	]);
}

function renderUsage(h) {
	const nb = h.nlbw || {}, t = nb.total;

	return E('div', [
		E('p', [ t
			? _('This accounting period: %s down, %s up, %d connections.').format(fmtBytes(t.rx_bytes), fmtBytes(t.tx_bytes), t.conns)
			: _('No traffic recorded by nlbwmon for this address in the current period.') ]),
		table([ _('Protocol / port'), _('Service'), _('Connections'), _('Down'), _('Up') ],
			(nb.top || []).map(r => [
				r.port ? '%s/%d'.format(r.proto, r.port) : r.proto,
				svc(r.proto, r.port) || '-', String(r.conns), fmtBytes(r.rx_bytes), fmtBytes(r.tx_bytes)
			]),
			_('No data'))
	]);
}

function renderSecurity(h, cs) {
	const sn = h.snort || {};
	let csEl;

	if (!cs)
		csEl = E('em', { 'class': 'spinning' }, [ _('checking…') ]);
	else if (!cs.available)
		csEl = E('em', [ _('CrowdSec not installed') ]);
	else if (!(cs.decisions || []).length)
		csEl = E('span', { 'class': 'label success' }, [ _('No active decision') ]);
	else
		csEl = E('span', { 'class': 'label warning' }, [ cs.decisions.map(d => '%s %s (%s, %s)'.format(d.type, d.duration || '', d.scenario || '-', d.origin)).join('; ') ]);

	return E('div', [
		E('table', { 'class': 'table' }, [
			row(_('CrowdSec'), csEl),
			row(_('Snort alerts involving this host'), String(sn.total || 0))
		]),
		(sn.recent && sn.recent.length)
			? table([ _('Time'), _('Message'), _('Source'), _('Destination'), _('SID') ],
				sn.recent.map(a => [ a.time || '-', a.msg || '-', '%s:%s'.format(a.src, a.sport || '-'), '%s:%s'.format(a.dst, a.dport || '-'), String(a.sid || '-') ]), '')
			: E([])
	]);
}

// ------------------------------------------------------------------ view

return view.extend({
	load: function() {
		const ip = new URLSearchParams(window.location.search).get('ip');
		return Promise.all([ L.resolveDefault(callLeases(), {}), ip && IP_RE.test(ip) ? ip : null ]);
	},

	renderPicker: function(leases) {
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', [ _('Host Monitor') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('Pick a device to monitor. You can also use the Monitor button in the DHCP leases table on the Overview page.') ]),
			E('div', { 'class': 'cbi-section' }, [
				table([ _('Hostname'), _('IPv4 address'), _('MAC address'), '' ],
					leases.map(l => [ l.hostname || '-', l.ipaddr, l.macaddr || '-',
						E('a', { 'class': 'btn cbi-button cbi-button-action', 'href': L.url('admin/status/hostmon') + '?ip=' + encodeURIComponent(l.ipaddr) }, [ _('Monitor') ]) ]),
					_('No active leases'))
			])
		]);
	},

	render: function(data) {
		const leases = ((data[0] || {}).dhcp_leases || []).sort((a, b) => {
			const n = s => s.split('.').reduce((acc, o) => acc * 256 + (+o), 0);
			return n(a.ipaddr) - n(b.ipaddr);
		});
		const ip = data[1];

		if (!ip)
			return this.renderPicker(leases);

		const lease = leases.filter(l => l.ipaddr == ip)[0];
		const title = lease && lease.hostname ? '%s (%s)'.format(lease.hostname, ip) : ip;

		const picker = E('select', {
			'class': 'cbi-input-select',
			'change': ev => { window.location.href = L.url('admin/status/hostmon') + '?ip=' + encodeURIComponent(ev.target.value); }
		}, leases.map(l => E('option', { 'value': l.ipaddr, 'selected': l.ipaddr == ip ? 'selected' : null }, [ '%s (%s)'.format(l.hostname || '-', l.ipaddr) ])));

		if (!lease)
			picker.insertBefore(E('option', { 'value': ip, 'selected': 'selected' }, [ ip ]), picker.firstChild);

		const svg = E('div', { 'style': 'position:relative;height:220px;border:1px solid rgba(128,128,128,.3);border-radius:4px;overflow:hidden' });
		const rateNow = E('span', [ '…' ]);
		const info = E('div', [ E('em', { 'class': 'spinning' }, [ _('Loading…') ]) ]);
		const conns = E('div', [ E('em', { 'class': 'spinning' }, [ _('Loading…') ]) ]);
		const usage = E('div', [ E('em', { 'class': 'spinning' }, [ _('Loading…') ]) ]);
		const security = E('div', [ E('em', { 'class': 'spinning' }, [ _('Loading…') ]) ]);
		const filter = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': _('Filter by address, port or service…') });

		const samples = [];
		let last = null, peakRx = 0, peakTx = 0, lastConns = { conns: [] }, lastHost = null, lastCs = null;

		filter.addEventListener('input', () => dom.content(conns, renderConns(lastConns, filter.value)));

		const tickRate = () => callRate(ip).then(r => {
			if (!r || r.error)
				return;

			if (last && r.uptime > last.uptime && r.rx_bytes >= last.rx_bytes && r.tx_bytes >= last.tx_bytes) {
				const dt = r.uptime - last.uptime;
				const s = { rx: (r.rx_bytes - last.rx_bytes) / dt, tx: (r.tx_bytes - last.tx_bytes) / dt };
				samples.push(s);
				if (samples.length > SAMPLES)
					samples.shift();
				peakRx = Math.max(peakRx, s.rx);
				peakTx = Math.max(peakTx, s.tx);
				dom.content(rateNow, [
					E('span', { 'style': 'color:#2f7ed8;font-weight:bold' }, [ '▼ ' + fmtRate(s.rx) ]), '  ',
					E('span', { 'style': 'color:#e8833a;font-weight:bold' }, [ '▲ ' + fmtRate(s.tx) ]),
					E('small', [ _('   peak ▼ %s ▲ %s').format(fmtRate(peakRx), fmtRate(peakTx)) ])
				]);
			}

			last = r;
			drawGraph(svg, samples);
		});

		const tickConns = () => callConns(ip).then(c => {
			lastConns = c || { conns: [] };
			dom.content(conns, renderConns(lastConns, filter.value));
		});

		const tickHost = () => callHost(ip).then(h => {
			lastHost = h || {};
			dom.content(info, renderInfo(lastHost, ip));
			dom.content(usage, renderUsage(lastHost));
			dom.content(security, renderSecurity(lastHost, lastCs));
		});

		tickRate();
		tickConns();
		tickHost().then(() => callCrowdsec(ip)).then(cs => {
			lastCs = cs || { available: false };
			dom.content(security, renderSecurity(lastHost || {}, lastCs));
		});

		poll.add(tickRate, 2);
		poll.add(tickConns, 5);
		poll.add(tickHost, 30);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', [ _('Host Monitor: %s').format(title) ]),
			E('div', { 'class': 'cbi-map-descr', 'style': 'display:flex;gap:1em;align-items:center;flex-wrap:wrap' }, [
				_('Device:'), picker,
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/status/hostmon') }, [ _('All devices') ])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', [ _('Live traffic through the router') ]),
				E('p', [ rateNow ]),
				svg,
				E('div', { 'class': 'cbi-section-descr' }, [
					_('Counts traffic the router itself handles for this device: internet, other networks and the router\'s own services (DNS, NTP). Traffic between two devices on the same network stays in the switch or Wi-Fi access point and is not seen. Updated every 2 seconds; last 5 minutes.')
				])
			]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', [ _('Device') ]), info ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', [ _('Current connections') ]), filter, conns ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', [ _('Usage this period (nlbwmon)') ]), usage ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', [ _('Security') ]), security ])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
