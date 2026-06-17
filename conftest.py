import pytest
import duckdb
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from db import init_schema


@pytest.fixture
def mem_conn():
    conn = duckdb.connect(":memory:")
    init_schema(conn)
    return conn
