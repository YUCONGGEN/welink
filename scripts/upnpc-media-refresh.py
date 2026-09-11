#!/usr/bin/env python3
"""Refresh only WeLink media mappings, preserving every existing service mapping."""
import argparse
import json
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--config', default=str(pathlib.Path.home() / 'bin/welink/welink.json'))
parser.add_argument('--upnpc', default='/opt/homebrew/bin/upnpc')
parser.add_argument('--igd', default='http://192.168.1.1:5431/gatedesc.xml')
args = parser.parse_args()
config = json.loads(pathlib.Path(args.config).read_text())['media']
if not config['enabled']:
    raise SystemExit(0)
port = int(config['listen'].rsplit(':', 1)[1])
low, high = config['relay_min_port'], config['relay_max_port']
assert 1024 <= low <= high <= 65534 and high - low < 256 and not low <= port <= high
route = subprocess.check_output(['/sbin/route', '-n', 'get', 'default'], text=True)
interface = re.search(r'interface:\s+(\S+)', route).group(1)
local_ip = subprocess.check_output(['/usr/sbin/ipconfig', 'getifaddr', interface], text=True).strip()
assert re.fullmatch(r'\d+\.\d+\.\d+\.\d+', local_ip)
base = [args.upnpc, '-u', args.igd]
listing = subprocess.check_output(base + ['-l'], text=True, timeout=20)
existing = {}
for line in listing.splitlines():
    if '->' not in line or not re.search(r'\b(?:TCP|UDP)\b', line):
        continue
    match = re.match(r'\s*\d+\s+(TCP|UDP)\s+(\d+)->([\d.]+):(\d+)\s+(.*)', line)
    if not match:
        raise RuntimeError('Unrecognized mapping entry; refusing to overwrite router state')
    protocol, external, address, internal, description = match.groups()
    existing[(protocol, int(external))] = (address, int(internal), description)
desired = [('TCP', port), ('UDP', port)] + [('UDP', value) for value in range(low, high + 1)]
for key in desired:
    if key in existing:
        address, internal, description = existing[key]
        if address != local_ip or internal != key[1] or 'WeLink-media' not in description:
            raise RuntimeError('Port is already owned by another mapping: %s %d' % key)
for index, (protocol, value) in enumerate(desired, 1):
    result = subprocess.run(base + ['-e', 'WeLink-media', '-a', local_ip, str(value), str(value), protocol], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
    if result.returncode != 0 or 'failed' in result.stdout.lower():
        raise RuntimeError('Cannot map %s %d: %s' % (protocol, value, result.stdout[-500:]))
    if index % 20 == 0:
        print('Verified %d media port mappings' % index, flush=True)
print('WeLink media: TCP/UDP %d, UDP %d-%d; other service mappings preserved' % (port, low, high), flush=True)
