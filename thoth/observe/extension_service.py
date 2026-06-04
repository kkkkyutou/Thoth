"""CLI-facing project extension management helpers."""

from __future__ import annotations

from thoth.observe.plugin_service import create_plugin as create_extension
from thoth.observe.plugin_service import list_plugins as list_extensions
from thoth.observe.plugin_service import validate_plugins as validate_extensions

__all__ = ["create_extension", "list_extensions", "validate_extensions"]
