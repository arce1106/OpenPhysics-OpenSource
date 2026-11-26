"""Read-only check that migrations cover the application's tables and columns."""

import asyncio
import json
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app.core.database import engine
from app.models import Base


async def main():
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    expected_heads = set(ScriptDirectory.from_config(config).get_heads())
    async with engine.connect() as connection:
        def compare(sync):
            inspector = inspect(sync)
            actual_tables = set(inspector.get_table_names())
            missing_tables = sorted(set(Base.metadata.tables) - actual_tables)
            missing_columns = {}
            for name, table in Base.metadata.tables.items():
                if name in actual_tables:
                    actual_columns = {column["name"] for column in inspector.get_columns(name)}
                    missing = sorted(set(table.columns.keys()) - actual_columns)
                    if missing:
                        missing_columns[name] = missing
            return missing_tables, missing_columns

        missing_tables, missing_columns = await connection.run_sync(compare)
        actual_heads = set((await connection.scalars(text("SELECT version_num FROM alembic_version"))).all())
    await engine.dispose()
    result = dict(
        passed=not missing_tables and not missing_columns and actual_heads == expected_heads,
        model_tables=len(Base.metadata.tables), missing_tables=missing_tables,
        missing_columns=missing_columns, migration_heads=sorted(actual_heads),
    )
    print(json.dumps(result, ensure_ascii=False))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
