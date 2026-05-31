import json
from pathlib import Path

from thoth.observe.plugin_service import validate_plugins
from thoth.privacy import scan_tree


ROOT = Path(__file__).resolve().parents[2]


def test_privacy_scan_catches_downstream_project_terms(tmp_path):
    leaked = tmp_path / "README.md"
    project_name = "3d" + "lmm"
    work_id = "EVA" + "00-T1.1"
    workspace_path = "/mnt" + "/cfs/private/" + project_name
    record_count = "500" + "20"
    leaked.write_text(
        f"project={project_name} work={work_id} path={workspace_path} records={record_count}\n",
        encoding="utf-8",
    )

    findings = scan_tree(tmp_path)

    kinds = {finding.kind for finding in findings}
    assert "private_project_name" in kinds
    assert "private_work_id" in kinds
    assert "private_workspace_path" in kinds
    assert "private_metric_count" in kinds


def test_privacy_scan_allows_current_public_tree():
    findings = scan_tree(ROOT)

    assert findings == []


def test_plugin_validate_rejects_private_plugin_artifacts(tmp_path):
    plugin_root = tmp_path / ".thoth" / "extensions" / "plugins" / "leaky"
    plugin_root.mkdir(parents=True)
    manifest = tmp_path / ".thoth" / "extensions" / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "kind": "thoth.extensions",
                "plugins": [
                    {
                        "id": "leaky",
                        "version": "0.1.0",
                        "enabled": True,
                        "trusted": True,
                        "surfaces": ["dashboard", "tui"],
                        "capabilities": ["tui_panel"],
                        "source": ".thoth/extensions/plugins/leaky",
                        "config": {},
                    }
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (plugin_root / "README.md").write_text(
        "Use /root/private/token and /opt/conda/envs/project-secret/bin/python.\n",
        encoding="utf-8",
    )

    result = validate_plugins(tmp_path)

    assert result["status"] == "failed"
    assert any("privacy:" in error for error in result["errors"])
    assert result["privacy_findings"]
