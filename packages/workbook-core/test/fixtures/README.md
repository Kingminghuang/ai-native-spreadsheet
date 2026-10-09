# Parquet interoperability fixtures

`generate_pyarrow.py` uses real **pyarrow 19.0.1 / parquet-cpp-arrow 19.0.1**, Python 3.12, to write five two-row files with `_row_id` and `field:fld_value` stable-ID columns. They use no compression and no dictionary encoding. Fixture values are synthetic and contain no user data.

Regenerate from the workbook-core package:

```sh
python -m venv /tmp/workbook-pyarrow
/tmp/workbook-pyarrow/bin/pip install --only-binary=:all: pyarrow==19.0.1
/tmp/workbook-pyarrow/bin/python test/fixtures/generate_pyarrow.py
```

- `pyarrow-int64.parquet`: ±(2^53−1), genuine INT64 file accepted through full Bundle import.
- `pyarrow-unsafe-int64.parquet`: ±2^53, rejected by JavaScript integer value range.
- `pyarrow-uint64.parquet`, `pyarrow-timestamp.parquet`, `pyarrow-decimal.parquet`: different semantic annotations, rejected against an integer Schema.

This pyarrow version writes the signed int64 column without an INTEGER annotation. The tests separately rebuild a local writer footer to test `INT_64`, `INTEGER(64,true)` and inconsistent annotations, and assert the actual metadata before decoding. These modified footers are synthetic compatibility cases, not claimed as default pyarrow behavior. Numeric schema metadata mutation leaves the encoded data pages unchanged.

The generated files are committed test inputs; `npm test` does not install or run Python. Source specification: [Apache Parquet logical types, signed integers](https://parquet.apache.org/docs/file-format/types/logicaltypes/#signed-integers).
