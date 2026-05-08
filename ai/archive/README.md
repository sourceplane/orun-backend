# AI History Archive

`tasks-reports-20260508.tar.gz` contains the full historical `ai/tasks/` and
`ai/reports/` Markdown trees through Task 0015.

The archive exists to preserve auditability while keeping routine AI context
small. Prefer `ai/context/*` for ordinary planning and only unpack this archive
when full historical prompt/report evidence is necessary.

Inspect without restoring into the working tree:

```bash
mkdir -p /tmp/orun-backend-ai-history
tar -xzf ai/archive/tasks-reports-20260508.tar.gz -C /tmp/orun-backend-ai-history
```
