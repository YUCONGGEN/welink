"""Verify that the APK contains the current shared UI and all supported native ABIs."""
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
apk = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/WeLink-Android.apk'
with zipfile.ZipFile(apk) as archive:
    files = [path for path in (root / 'internal/ui/assets').rglob('*') if path.is_file()]
    for path in files:
        name = 'assets/ui/' + path.relative_to(root / 'internal/ui/assets').as_posix()
        if archive.read(name) != path.read_bytes():
            raise SystemExit('APK UI does not match source: ' + name)
    supported = ['arm64-v8a']
    for abi in supported:
        if f'lib/{abi}/libgojni.so' not in archive.namelist():
            raise SystemExit('APK native ABI missing: ' + abi)
    extra = sorted({n.split('/')[1] for n in archive.namelist() if n.startswith('lib/')} - set(supported))
    if extra:
        raise SystemExit('APK contains unsupported native ABIs: ' + ', '.join(extra))
print(f'APK verified: {len(files)} current UI files and the arm64-v8a native ABI')
