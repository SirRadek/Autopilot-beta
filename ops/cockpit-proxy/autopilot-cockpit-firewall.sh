#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

identity=/var/lib/autopilot-cockpit/firewall.identity
template=/etc/nftables.d/autopilot-cockpit.nft
table=autopilot_cockpit
[ "$EUID" -eq 0 ]
[ "$#" -eq 1 ]
case "$1" in start|stop) action="$1" ;; *) exit 1 ;; esac
[ -f "$identity" ] && [ ! -L "$identity" ] && [ "$(stat -c %u:%g:%a "$identity")" = 0:0:600 ]
[ -f "$template" ] && [ ! -L "$template" ] && [ "$(stat -c %u:%g:%a "$template")" = 0:0:644 ]
nonce="$(cat "$identity")"
[[ "$nonce" =~ ^[a-f0-9]{64}$ ]]

presence() {
	local json
	json="$(timeout --signal=TERM --kill-after=2s 10s nft -j list tables)"
	NFT_JSON="$json" node -e '
const d=JSON.parse(process.env.NFT_JSON);const m=(d.nftables??[]).filter(x=>x.table?.family==="inet"&&x.table?.name==="autopilot_cockpit");
if(m.length>1)process.exit(2);process.stdout.write(m.length?"present":"absent");'
}

identity_valid() {
	local json
	json="$(timeout --signal=TERM --kill-after=2s 10s nft -j list table inet "$table")"
	NFT_JSON="$json" NFT_NONCE="$nonce" node -e '
const d=JSON.parse(process.env.NFT_JSON), e=d.nftables??[], c=`autopilot-cockpit:${process.env.NFT_NONCE}`;
const t=e.filter(x=>x.table?.family==="inet"&&x.table?.name==="autopilot_cockpit");
const ch=e.filter(x=>x.chain?.family==="inet"&&x.chain?.table==="autopilot_cockpit"&&x.chain?.name==="input");
const r=e.filter(x=>x.rule?.family==="inet"&&x.rule?.table==="autopilot_cockpit"&&x.rule?.chain==="input");
if(t.length!==1||ch.length!==1||r.length!==1||t[0].table.comment!==c||ch[0].chain.comment!==c||r[0].rule.comment!==c)process.exit(1);
const chain=ch[0].chain;if(chain.type!=="filter"||chain.hook!=="input"||chain.prio!==-10||chain.policy!=="accept")process.exit(1);
const x=[{match:{op:"==",left:{payload:{protocol:"tcp",field:"dport"}},right:{set:[80,443]}}},{match:{op:"!=",left:{payload:{protocol:"ip",field:"saddr"}},right:"192.168.122.1"}},{drop:null}];
if(JSON.stringify(r[0].rule.expr)!==JSON.stringify(x))process.exit(1);'
}

if [ "$action" = start ]; then
	[ "$(presence)" = absent ]
	tmp="$(mktemp /run/autopilot-cockpit-nft.XXXXXXXXXX)"
	trap 'rm -f -- "${tmp:-}"' EXIT
	sed "s/__AUTOPILOT_COCKPIT_NONCE__/$nonce/g" "$template" > "$tmp"
	chmod 0600 "$tmp"
	timeout --signal=TERM --kill-after=2s 10s nft -f "$tmp"
	identity_valid
	exit 0
fi

identity_valid
timeout --signal=TERM --kill-after=2s 10s nft delete table inet "$table"
[ "$(presence)" = absent ]
