#!/usr/bin/env python3
"""Package the cross-built Apple Silicon client as a macOS .app zip."""
import os
import pathlib
import plistlib
import shutil
import stat
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
binary = root / ".local" / "LinkMe-macOS-arm64"
icon = root / "packaging" / "linkme.icns"
app = root / "dist" / "LinkMe.app"
if not binary.is_file() or not icon.is_file():
    raise SystemExit("Build .local/LinkMe-macOS-arm64 and packaging/linkme.icns first")

contents = app / "Contents"
macos = contents / "MacOS"
resources = contents / "Resources"
shutil.rmtree(app, ignore_errors=True)
macos.mkdir(parents=True)
resources.mkdir()
exe = macos / "LinkMe"
shutil.copy2(binary, exe)
exe.chmod(0o755)
shutil.copy2(icon, resources / "linkme.icns")

# Optional official Codex runtime can be bundled at this stable path.
codex = root / ".local" / "codex-macos" / "tools" / "codex"
if codex.is_dir():
    shutil.copytree(codex, resources / "tools" / "codex")
    for item in (resources / "tools" / "codex").rglob("*"):
        if item.is_file():
            item.chmod(item.stat().st_mode | stat.S_IXUSR if item.name == "codex" else item.stat().st_mode)

info = {
    "CFBundleName": "LinkMe",
    "CFBundleDisplayName": "LinkMe",
    "CFBundleIdentifier": "cn.yucg.linkme",
    "CFBundleVersion": "0.1.15",
    "CFBundleShortVersionString": "0.1.15",
    "CFBundleExecutable": "LinkMe",
    "CFBundleIconFile": "linkme.icns",
    "LSMinimumSystemVersion": "12.0",
    "LSApplicationCategoryType": "public.app-category.social-networking",
    "NSHighResolutionCapable": True,
    "LSApplicationIsScriptable": False,
    "CFBundleURLTypes": [{
        "CFBundleURLName": "LinkMe meeting invitation",
        "CFBundleURLSchemes": ["welink"],
    }],
}
with (contents / "Info.plist").open("wb") as stream:
    plistlib.dump(info, stream, sort_keys=True)

archive = root / "dist" / "LinkMe-macOS-arm64.zip"
archive.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for path in sorted(app.rglob("*")):
        rel = pathlib.PurePosixPath(path.relative_to(root / "dist").as_posix())
        entry = zipfile.ZipInfo(str(rel) + ("/" if path.is_dir() else ""))
        entry.create_system = 3
        executable = path == exe or path.parts[-3:-1] == ("tools", "codex")
        mode = stat.S_IFDIR | 0o755 if path.is_dir() else stat.S_IFREG | (0o755 if executable else 0o644)
        entry.external_attr = mode << 16
        entry.compress_type = zipfile.ZIP_DEFLATED
        if path.is_file():
            zf.writestr(entry, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        else:
            zf.writestr(entry, b"")
print(archive)
