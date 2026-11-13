// SPDX-License-Identifier: Apache-2.0
//
// Invisible Overview include: adds a "Monitor" button to every row of the
// DHCP leases table rendered by 40_dhcp.js (luci-mod-status), without
// modifying that file. The Overview calls render() for each include in
// order on every refresh, so this runs right after the leases table is
// rebuilt. Returning null keeps this include's own section hidden.
'use strict';
'require baseclass';

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function addButtons() {
	const tbl = document.getElementById('status_leases');
	if (!tbl)
		return;

	tbl.querySelectorAll('tr.tr').forEach(tr => {
		if (tr.classList.contains('table-titles') || tr.classList.contains('placeholder') || tr.querySelector('.hostmon-btn'))
			return;

		const cells = tr.querySelectorAll('td');
		let ip = null;

		cells.forEach(td => {
			if (!ip && IP_RE.test(td.textContent.trim()))
				ip = td.textContent.trim();
		});

		if (!ip || !cells.length)
			return;

		const btn = E('a', {
			'class': 'btn cbi-button cbi-button-action hostmon-btn',
			'href': L.url('admin/status/hostmon') + '?ip=' + encodeURIComponent(ip),
			'data-tooltip': _('Live traffic, connections and security events for this device'),
			'style': 'margin-left:.3em'
		}, [ _('Monitor') ]);

		const last = cells[cells.length - 1];
		if (last.querySelector('button'))
			last.appendChild(btn);
		else
			tr.appendChild(E('td', { 'class': 'td cbi-section-actions' }, [ btn ]));
	});
}

let observer = null;

return baseclass.extend({
	title: null,

	render: function() {
		addButtons();

		// Catch re-renders that happen outside the include cycle as well.
		if (!observer && window.MutationObserver) {
			observer = new MutationObserver(addButtons);
			observer.observe(document.body, { childList: true, subtree: true });
		}

		return null;
	}
});
