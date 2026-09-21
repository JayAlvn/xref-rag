# Builds the backend into one executable:
#   pyinstaller backend.spec --noconfirm --clean
import os

import wordninja
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

datas = []
binaries = []
hiddenimports = []

# These load parts of themselves at run time, out of PyInstaller's sight.
for package in ("chromadb", "chromadb_rust_bindings", "onnxruntime", "tokenizers", "pymupdf", "zstandard"):
    package_datas, package_binaries, package_imports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_imports

datas += collect_data_files("docx")
hiddenimports += collect_submodules("uvicorn")

# wordninja is a single module whose word list sits in a folder beside it,
# so no collect_* helper finds it.
word_list = os.path.join(os.path.dirname(wordninja.__file__), "wordninja", "wordninja_words.txt.gz")
datas.append((word_list, "wordninja"))

a = Analysis(
    ["main.py"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    # Never bundle these, even when the build machine has them installed.
    excludes=["torch", "sentence_transformers", "transformers"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="backend",
    console=True,
    upx=False,
)
