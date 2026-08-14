# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_dynamic_libs
from PyInstaller.utils.hooks import collect_all

datas = [
    ('playwright-browsers', 'playwright-browsers'),
    ('nomenclador_pami.xlsx', '.'),
    ('73-Nomenclador Pami valorizado 04-2026.xlsx', '.'),
]
if Path('credentials/credentials.json').exists():
    datas.append(('credentials/credentials.json', 'resources'))
if Path('resources/credentials.json').exists():
    datas.append(('resources/credentials.json', 'resources'))
datas += [(str(path), '.') for path in Path('.').glob('usuarios_*.json')]
binaries = []
hiddenimports = []
datas += collect_data_files('openpyxl')
datas += collect_data_files('playwright')
binaries += collect_dynamic_libs('playwright')
tmp_ret = collect_all('customtkinter')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
for package in ('rapidocr_onnxruntime', 'onnxruntime', 'pytesseract'):
    tmp_ret = collect_all(package)
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Consulta PAMI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    uac_admin=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Consulta PAMI',
)
