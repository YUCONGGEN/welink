from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
outputs = root / 'mobile' / 'build'
target = root / 'mobile' / 'android' / 'app' / 'libs' / 'welink-core.aar'
with ZipFile(target, 'w', ZIP_DEFLATED) as output:
    seen = set()
    for abi in ('arm64', 'arm', 'amd64', '386'):
        with ZipFile(outputs / f'core-{abi}.aar') as archive:
            for name in archive.namelist():
                if name in seen:
                    continue
                if abi != 'arm64' and not name.startswith('jni/'):
                    continue
                output.writestr(name, archive.read(name))
                seen.add(name)
print(f'Merged {sum(x.endswith(".so") for x in seen)} native ABIs into {target}')
