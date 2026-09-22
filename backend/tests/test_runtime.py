from pathlib import Path, PureWindowsPath

from generation import runtime


def test_a_non_latin_user_folder_is_not_suggested_on_windows(monkeypatch):
    monkeypatch.setattr(runtime.sys, "platform", "win32")
    monkeypatch.setattr(runtime, "DATA_DIR", Path("C:/Users/Адмін/AppData/Local/com.jayalvn.xref-rag"))
    monkeypatch.setenv("SystemDrive", "C:")

    assert PureWindowsPath(runtime.suggested_storage()) == PureWindowsPath("C:\\xref-rag")


def test_a_latin_user_folder_is_suggested_as_it_is(monkeypatch):
    folder = Path("C:/Users/Anna/AppData/Local/com.jayalvn.xref-rag")
    monkeypatch.setattr(runtime.sys, "platform", "win32")
    monkeypatch.setattr(runtime, "DATA_DIR", folder)

    assert runtime.suggested_storage() == folder


def test_a_path_with_non_latin_letters_is_refused_on_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime.sys, "platform", "win32")

    problem = runtime._storage_problem(tmp_path / "Моделі", create=False)

    assert "non-Latin" in problem


def test_a_relative_path_is_refused():
    assert "full path" in runtime._storage_problem(Path("models"), create=False)


def test_a_usable_folder_is_accepted_and_created(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "_SPACE_NEEDED", 1)
    folder = tmp_path / "xref-rag"

    assert runtime._storage_problem(folder, create=True) == ""
    assert folder.is_dir()


def test_too_little_space_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "_SPACE_NEEDED", 10**18)

    assert "Not enough space" in runtime._storage_problem(tmp_path, create=False)


def test_the_chosen_folder_is_remembered(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "_SPACE_NEEDED", 1)
    monkeypatch.setattr(runtime, "_STORAGE_FILE", tmp_path / "storage.json")
    chosen = tmp_path / "models-here"

    runtime._choose_storage(str(chosen))

    assert runtime.storage() == chosen
    assert runtime._program().is_relative_to(chosen)
