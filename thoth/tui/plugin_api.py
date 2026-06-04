"""Trusted Python plugin API for Thoth TUI panels."""

from __future__ import annotations

import importlib.util
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Protocol

from thoth.observe.extensions import ExtensionPlugin, enabled_extension_plugins


PYTHON_TUI_CAPABILITIES = {"tui_python_plugin", "tui_panel"}
DEFAULT_RENDER_BUDGET_MS = 50.0


class TuiProvider(Protocol):
    def refresh(self, previous: Any | None = None) -> Any:
        ...


class TuiRenderer(Protocol):
    def render(self, state: Any, ui_state: dict[str, Any], size: tuple[int, int] | None = None) -> Any:
        ...

    def handle_key(self, key: str, ui_state: dict[str, Any], state: Any) -> dict[str, Any] | None:
        ...


ProviderFactory = Callable[["TuiPluginContext"], TuiProvider | Any]
RendererFactory = Callable[["TuiPluginContext"], TuiRenderer | Any]


@dataclass(frozen=True)
class TuiPluginContext:
    project_root: Path
    plugin_id: str
    source_root: Path
    config: dict[str, Any]


@dataclass(frozen=True)
class TuiPanelSpec:
    id: str
    title: str
    order: int = 100
    provider_factory: ProviderFactory | None = None
    renderer_factory: RendererFactory | None = None
    refresh_seconds: float = 2.0
    render_budget_ms: float = DEFAULT_RENDER_BUDGET_MS


@dataclass(frozen=True)
class LoadedTuiPanel:
    plugin_id: str
    spec: TuiPanelSpec
    context: TuiPluginContext


@dataclass(frozen=True)
class TuiPluginLoadResult:
    panels: tuple[LoadedTuiPanel, ...]
    notices: tuple[dict[str, Any], ...]


class TuiPluginRegistry:
    def __init__(self) -> None:
        self._panels: dict[str, TuiPanelSpec] = {}

    def register_panel(self, spec: TuiPanelSpec) -> None:
        if spec.id in self._panels:
            raise ValueError(f"Duplicate TUI panel id: {spec.id}")
        self._panels[spec.id] = spec

    def panels(self) -> list[TuiPanelSpec]:
        return sorted(self._panels.values(), key=lambda panel: (panel.order, panel.id))


def tui_plugin_audit_notices(project_root: Path, *, no_python_plugins: bool = False) -> list[dict[str, Any]]:
    return list(load_tui_python_plugins(project_root, no_python_plugins=no_python_plugins, load_modules=False).notices)


def _notice(plugin_id: str, level: str, message: str, **extra: Any) -> dict[str, Any]:
    payload = {"plugin_id": plugin_id, "level": level, "message": message}
    payload.update(extra)
    return payload


def _plugin_source_root(project_root: Path, plugin: ExtensionPlugin) -> Path:
    source = Path(plugin.source)
    if not source.is_absolute():
        source = project_root / source
    return source.resolve()


def _allowed_source_root(project_root: Path, plugin: ExtensionPlugin) -> Path:
    return (project_root / ".thoth" / "extensions" / "plugins" / plugin.plugin_id).resolve()


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _entrypoint_path(source_root: Path, entrypoint: Any) -> Path | None:
    if not isinstance(entrypoint, str) or not entrypoint.strip():
        return None
    path = Path(entrypoint)
    if path.is_absolute():
        return path.resolve()
    return (source_root / path).resolve()


def _load_module(path: Path, plugin_id: str) -> ModuleType:
    module_name = f"thoth_tui_plugin_{plugin_id.replace('-', '_')}_{int(time.time() * 1000)}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load plugin module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _accepts_tui_python(plugin: ExtensionPlugin) -> bool:
    return "tui" in plugin.surfaces and bool(PYTHON_TUI_CAPABILITIES.intersection(plugin.capabilities))


def load_tui_python_plugins(
    project_root: str | Path,
    *,
    no_python_plugins: bool = False,
    load_modules: bool = True,
) -> TuiPluginLoadResult:
    """Load trusted project Python TUI panels from the extension manifest."""

    root = Path(project_root).resolve()
    notices: list[dict[str, Any]] = []
    loaded: list[LoadedTuiPanel] = []
    seen_panel_ids: set[str] = set()
    for plugin in enabled_extension_plugins(root):
        if not _accepts_tui_python(plugin):
            continue
        if no_python_plugins:
            notices.append(_notice(plugin.plugin_id, "info", "Python TUI plugin skipped by --no-python-plugins."))
            continue
        if not plugin.trusted:
            notices.append(_notice(plugin.plugin_id, "warning", "Python TUI plugin requires manifest trusted=true."))
            continue
        source_root = _plugin_source_root(root, plugin)
        allowed_root = _allowed_source_root(root, plugin)
        if source_root != allowed_root:
            notices.append(
                _notice(
                    plugin.plugin_id,
                    "error",
                    "Python TUI extension source must be .thoth/extensions/plugins/<extension_id>.",
                    source=str(source_root),
                    expected=str(allowed_root),
                )
            )
            continue
        entrypoint = _entrypoint_path(source_root, plugin.config.get("entrypoint"))
        if entrypoint is None:
            notices.append(_notice(plugin.plugin_id, "error", "Python TUI plugin config.entrypoint is required."))
            continue
        if not _is_relative_to(entrypoint, source_root):
            notices.append(_notice(plugin.plugin_id, "error", "Python TUI extension entrypoint escapes extension source root."))
            continue
        if not entrypoint.exists():
            notices.append(_notice(plugin.plugin_id, "error", f"Python TUI plugin entrypoint not found: {entrypoint}"))
            continue
        if not load_modules:
            notices.append(_notice(plugin.plugin_id, "info", "Python TUI plugin trusted and discoverable.", entrypoint=str(entrypoint)))
            continue
        registry = TuiPluginRegistry()
        try:
            module = _load_module(entrypoint, plugin.plugin_id)
            register = getattr(module, "register", None)
            if not callable(register):
                raise AttributeError("plugin module must expose register(registry)")
            register(registry)
            context = TuiPluginContext(project_root=root, plugin_id=plugin.plugin_id, source_root=source_root, config=dict(plugin.config))
            for panel in registry.panels():
                panel_id = f"{plugin.plugin_id}:{panel.id}"
                if panel_id in seen_panel_ids:
                    raise ValueError(f"Duplicate loaded TUI panel id: {panel_id}")
                seen_panel_ids.add(panel_id)
                loaded.append(LoadedTuiPanel(plugin_id=plugin.plugin_id, spec=panel, context=context))
            notices.append(_notice(plugin.plugin_id, "info", "Python TUI plugin loaded.", panel_count=len(registry.panels())))
        except Exception as exc:
            notices.append(
                _notice(
                    plugin.plugin_id,
                    "error",
                    f"{type(exc).__name__}: {exc}",
                    traceback=traceback.format_exc(limit=8),
                )
            )
    return TuiPluginLoadResult(tuple(sorted(loaded, key=lambda panel: (panel.spec.order, panel.plugin_id, panel.spec.id))), tuple(notices))
