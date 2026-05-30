"""Static regressions for the generated dashboard frontend template."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).parent.parent.parent
FRONTEND = ROOT / "templates" / "dashboard" / "frontend" / "src"


def test_workbench_uses_sse_without_fixed_full_refresh_timer():
    source = (FRONTEND / "views" / "WorkbenchView.vue").read_text(encoding="utf-8")

    assert "new EventSource(`/api/invalidation/stream" in source
    assert "applyDashboardDelta(queryClient" in source
    assert "window.setInterval" not in source
    assert "20000" not in source


def test_delta_path_mapping_scopes_query_invalidations():
    source = (FRONTEND / "api" / "invalidation.ts").read_text(encoding="utf-8")

    assert ".thoth/runs/" in source
    assert ".thoth/objects/" in source
    assert ".thoth/extensions/" in source
    assert "dashboardQueryKeys.workItemPrefix" in source
    assert "dashboardQueryKeys.root" in source


def test_legacy_dashboard_views_and_exclusive_components_are_removed():
    removed = [
        "views/OverviewPanel.vue",
        "views/WorkItemsPanel.vue",
        "views/DagPanel.vue",
        "views/TimelinePanel.vue",
        "views/TodoPanel.vue",
        "views/ActivityPanel.vue",
        "views/MilestonesPanel.vue",
        "components/activity/ActivityLog.vue",
        "components/charts/DagChart.vue",
        "components/charts/GanttChart.vue",
        "components/charts/TimelineChart.vue",
        "components/tasks/WorkItemBoard.vue",
        "components/tree/DirectionNode.vue",
    ]

    assert all(not (FRONTEND / path).exists() for path in removed)
