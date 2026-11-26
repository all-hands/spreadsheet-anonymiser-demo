mod delimited;
mod jsonl;

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableFormat {
    Csv,
    Tsv,
    Jsonl,
}

impl TableFormat {
    pub fn name(self) -> &'static str {
        match self {
            TableFormat::Csv => "csv",
            TableFormat::Tsv => "tsv",
            TableFormat::Jsonl => "jsonl",
        }
    }

    fn delimiter(self) -> u8 {
        if self == TableFormat::Tsv {
            b'\t'
        } else {
            b','
        }
    }

    fn label(self) -> &'static str {
        match self {
            TableFormat::Csv => "CSV",
            TableFormat::Tsv => "TSV",
            TableFormat::Jsonl => "JSONL",
        }
    }
}

impl std::str::FromStr for TableFormat {
    type Err = TableError;
    fn from_str(s: &str) -> Result<Self, TableError> {
        match s {
            "csv" => Ok(TableFormat::Csv),
            "tsv" => Ok(TableFormat::Tsv),
            "jsonl" => Ok(TableFormat::Jsonl),
            _ => Err(TableError::UnknownFormat),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TableError {
    #[error("unknown table format: expected csv, tsv or jsonl")]
    UnknownFormat,
    #[error(
        "{format} record {record} (line {line}): found {found} fields, but the header has {expected}"
    )]
    UnequalLengths {
        format: &'static str,
        record: u64,
        line: u64,
        expected: usize,
        found: usize,
    },
    #[error("{format} line {line}: not valid UTF-8")]
    InvalidUtf8 { format: &'static str, line: u64 },
    #[error("JSONL line {line}: invalid JSON: {reason} (column {column})")]
    Json {
        line: u64,
        column: usize,
        reason: String,
    },
    #[error("JSONL line {line}: expected a JSON object")]
    NotAnObject { line: u64 },
    #[error("JSONL line {line}: unsupported nested JSON value")]
    Nested { line: u64 },
    #[error(
        "JSONL line {line}: record has a key not in the header set ({}) — refusing to silently drop data",
        .headers.join(", ")
    )]
    UnknownKey {
        line: u64,
        headers: Vec<String>,
        key: String,
    },
    #[error("output row {row} has {found} cells, but the header has {expected}")]
    RowLength {
        row: u64,
        expected: usize,
        found: usize,
    },
    #[error("table decoder used after it failed or finished")]
    Closed,
}

#[derive(Clone, Copy, Debug)]
pub struct Row<'a> {
    text: &'a str,
    ends: &'a [usize],
}

impl<'a> Row<'a> {
    fn new(text: &'a str, ends: &'a [usize]) -> Self {
        Row { text, ends }
    }

    pub fn len(&self) -> usize {
        self.ends.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }

    pub fn concat(&self) -> &'a str {
        &self.text[..self.ends.last().copied().unwrap_or(0)]
    }

    pub fn ends(&self) -> &'a [usize] {
        self.ends
    }

    pub fn get(&self, i: usize) -> Option<&'a str> {
        let end = *self.ends.get(i)?;
        let start = if i == 0 { 0 } else { self.ends[i - 1] };
        Some(&self.text[start..end])
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = &'a str> + '_ {
        (0..self.ends.len()).map(move |i| self.get(i).unwrap_or_default())
    }
}

pub trait RowSink {
    fn headers(&mut self, headers: &[String]);
    fn row(&mut self, row: Row<'_>);
}

enum Inner {
    Delimited(Box<delimited::Decoder>),
    Jsonl(jsonl::Decoder),
}

pub struct TableDecoder {
    inner: Inner,
    closed: bool,
}

impl TableDecoder {
    pub fn new(format: TableFormat) -> Self {
        let inner = match format {
            TableFormat::Jsonl => Inner::Jsonl(jsonl::Decoder::new()),
            other => Inner::Delimited(Box::new(delimited::Decoder::new(other))),
        };
        TableDecoder {
            inner,
            closed: false,
        }
    }

    pub fn push(&mut self, input: &[u8], sink: &mut impl RowSink) -> Result<(), TableError> {
        if self.closed {
            return Err(TableError::Closed);
        }
        let res = match &mut self.inner {
            Inner::Delimited(d) => d.push(input, sink),
            Inner::Jsonl(d) => d.push(input, sink),
        };
        self.closed = res.is_err();
        res
    }

    pub fn finish(&mut self, sink: &mut impl RowSink) -> Result<(), TableError> {
        if self.closed {
            return Err(TableError::Closed);
        }
        self.closed = true;
        match &mut self.inner {
            Inner::Delimited(d) => d.finish(sink),
            Inner::Jsonl(d) => d.finish(sink),
        }
    }

    pub fn headers(&self) -> Option<&[String]> {
        match &self.inner {
            Inner::Delimited(d) => d.headers(),
            Inner::Jsonl(d) => d.headers(),
        }
    }
}

pub struct TableEncoder {
    format: TableFormat,
    headers: Vec<String>,
    rows: u64,
    csv: csv_core::Writer,
}

impl TableEncoder {
    pub fn new(format: TableFormat, headers: Vec<String>) -> Self {
        TableEncoder {
            format,
            headers,
            rows: 0,
            csv: delimited::writer(format),
        }
    }

    pub fn headers(&self) -> &[String] {
        &self.headers
    }

    pub fn write_header(&mut self, out: &mut Vec<u8>) {
        if self.format != TableFormat::Jsonl {
            let headers = self.headers.iter().map(String::as_str);
            delimited::write_record(&mut self.csv, headers, out);
        }
    }

    pub fn write_row<'c, I>(&mut self, cells: I, out: &mut Vec<u8>) -> Result<(), TableError>
    where
        I: IntoIterator<Item = &'c str>,
        I::IntoIter: ExactSizeIterator + Clone,
    {
        let cells = cells.into_iter();
        self.rows += 1;
        if cells.len() != self.headers.len() {
            return Err(TableError::RowLength {
                row: self.rows,
                expected: self.headers.len(),
                found: cells.len(),
            });
        }
        match self.format {
            TableFormat::Jsonl => jsonl::write_record(&self.headers, cells, out),
            _ => delimited::write_record(&mut self.csv, cells, out),
        }
        Ok(())
    }
}
