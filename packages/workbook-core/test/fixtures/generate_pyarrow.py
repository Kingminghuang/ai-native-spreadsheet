"""Generate genuine third-party stable-ID Parquet fixtures with pyarrow==19.0.1.
Run from the workbook-core package: python test/fixtures/generate_pyarrow.py.
Python/pyarrow are only needed to regenerate, not to execute npm test.
"""
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq

root = Path(__file__).parent
rows = ["row_min", "row_max"]
for name, dtype, values in [
    ("pyarrow-int64.parquet", pa.int64(), [-(2**53-1), 2**53-1]),
    ("pyarrow-unsafe-int64.parquet", pa.int64(), [-(2**53), 2**53]),
    ("pyarrow-uint64.parquet", pa.uint64(), [1, 2]),
    ("pyarrow-timestamp.parquet", pa.timestamp('us'), [1, 2]),
    ("pyarrow-decimal.parquet", pa.decimal128(8, 0), [1, 2]),
]:
    table = pa.Table.from_arrays([pa.array(rows), pa.array(values, type=dtype)], names=["_row_id", "field:fld_value"])
    pq.write_table(table, root / name, compression="NONE", use_dictionary=False, version="2.6")
    print(name, pq.read_metadata(root / name).created_by, pq.read_schema(root / name))
