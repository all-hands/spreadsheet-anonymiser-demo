use anonymiser_core::{Row, RowSink, TableDecoder, TableEncoder, TableError, TableFormat};
use anyhow::{anyhow, bail, Context, Result};
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

const IO_SLICE: usize = 64 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Debug, clap::ValueEnum)]
pub(crate) enum Format {
    Csv,
    Tsv,
    Jsonl,
}

impl Format {
    pub(crate) fn name(self) -> &'static str {
        self.table().name()
    }

    fn table(self) -> TableFormat {
        match self {
            Format::Csv => TableFormat::Csv,
            Format::Tsv => TableFormat::Tsv,
            Format::Jsonl => TableFormat::Jsonl,
        }
    }
}

pub(crate) fn infer_format(path: &Path) -> Format {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "tsv" | "tab" => Format::Tsv,
        "jsonl" | "ndjson" => Format::Jsonl,
        _ => Format::Csv,
    }
}

pub(crate) fn resolve_format(explicit: Option<Format>, paths: &[&Path]) -> Format {
    if let Some(f) = explicit {
        return f;
    }
    paths
        .iter()
        .map(|p| infer_format(p))
        .find(|f| *f != Format::Csv)
        .unwrap_or(Format::Csv)
}

fn open_input(path: &Path) -> Result<Box<dyn Read + Send>> {
    if path.as_os_str() == "-" {
        Ok(Box::new(std::io::stdin()))
    } else {
        Ok(Box::new(
            File::open(path).with_context(|| format!("open {path:?}"))?,
        ))
    }
}

fn read_error(path: &Path, e: TableError) -> anyhow::Error {
    match e {
        TableError::UnknownKey { key, headers, .. } => anyhow!(
            "{path:?}: record has key {key:?} which is not in the header set ({}) — \
             refusing to silently drop data",
            headers.join(", ")
        ),
        other => anyhow!("{path:?}: {other}"),
    }
}

#[derive(Default)]
struct Queue {
    headers: Option<Vec<String>>,
    rows: VecDeque<csv::StringRecord>,
}

impl RowSink for Queue {
    fn headers(&mut self, headers: &[String]) {
        self.headers = Some(headers.to_vec());
    }
    fn row(&mut self, row: Row<'_>) {
        let mut record =
            csv::StringRecord::with_capacity(row.iter().map(str::len).sum(), row.len());
        for field in row.iter() {
            record.push_field(field);
        }
        self.rows.push_back(record);
    }
}

pub(crate) struct TableReader {
    path: PathBuf,
    input: Box<dyn Read + Send>,
    decoder: TableDecoder,
    queue: Queue,
    headers: csv::StringRecord,
    buf: Vec<u8>,
    eof: bool,
    failed: Option<anyhow::Error>,
}

impl TableReader {
    pub(crate) fn open(path: &Path, format: Format) -> Result<Self> {
        let mut rdr = Self {
            path: path.to_path_buf(),
            input: open_input(path)?,
            decoder: TableDecoder::new(format.table()),
            queue: Queue::default(),
            headers: csv::StringRecord::new(),
            buf: vec![0; IO_SLICE],
            eof: false,
            failed: None,
        };
        while rdr.queue.headers.is_none() && !rdr.eof {
            rdr.fill()?;
        }
        if rdr.queue.headers.is_none() {
            if let Some(e) = rdr.failed.take() {
                return Err(e);
            }
        }
        match rdr.queue.headers.take() {
            Some(h) => rdr.headers = csv::StringRecord::from(h),
            None if format == Format::Jsonl => bail!("{path:?}: no JSON records found"),
            None => {}
        }
        Ok(rdr)
    }

    fn fill(&mut self) -> Result<()> {
        let n = loop {
            match self.input.read(&mut self.buf) {
                Ok(n) => break n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e).with_context(|| format!("read {:?}", self.path)),
            }
        };
        let res = if n == 0 {
            self.eof = true;
            self.decoder.finish(&mut self.queue)
        } else {
            self.decoder.push(&self.buf[..n], &mut self.queue)
        };
        if let Err(e) = res {
            self.failed = Some(read_error(&self.path, e));
            self.eof = true;
        }
        Ok(())
    }

    pub(crate) fn headers(&self) -> &csv::StringRecord {
        &self.headers
    }

    pub(crate) fn next_record(&mut self) -> Result<Option<csv::StringRecord>> {
        while self.queue.rows.is_empty() && !self.eof {
            self.fill()?;
        }
        match self.queue.rows.pop_front() {
            Some(row) => Ok(Some(row)),
            None => self.failed.take().map_or(Ok(None), Err),
        }
    }
}

pub(crate) enum Output {
    Stdout,
    File(PathBuf),
}

impl Output {
    pub(crate) fn from_path(path: &Path) -> Self {
        if path.as_os_str() == "-" {
            Output::Stdout
        } else {
            Output::File(path.to_path_buf())
        }
    }
}

pub(crate) struct TableWriter {
    encoder: TableEncoder,
    sink: Box<dyn Write + Send>,
    buf: Vec<u8>,
    dest: Option<PathBuf>,
    committed: bool,
}

impl Drop for TableWriter {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        match &self.dest {
            Some(path) => {
                drop(std::mem::replace(&mut self.sink, Box::new(std::io::sink())));
                let _ = fs::remove_file(format!("{}.part", path.display()));
            }
            None => {
                let _ = self.sink.write_all(&self.buf);
                let _ = self.sink.flush();
            }
        }
    }
}

impl TableWriter {
    pub(crate) fn create(out: Output, format: Format, headers: &csv::StringRecord) -> Result<Self> {
        let (sink, dest): (Box<dyn Write + Send>, Option<PathBuf>) = match out {
            Output::Stdout => (Box::new(std::io::stdout()), None),
            Output::File(path) => {
                let tmp = PathBuf::from(format!("{}.part", path.display()));
                let _ = fs::remove_file(&tmp);
                let f = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&tmp)
                    .with_context(|| format!("create {tmp:?}"))?;
                (Box::new(BufWriter::new(f)), Some(path))
            }
        };
        let mut encoder =
            TableEncoder::new(format.table(), headers.iter().map(str::to_owned).collect());
        let mut buf = Vec::with_capacity(2 * IO_SLICE);
        encoder.write_header(&mut buf);
        Ok(Self {
            encoder,
            sink,
            buf,
            dest,
            committed: false,
        })
    }

    pub(crate) fn write_record(&mut self, record: &csv::StringRecord) -> Result<()> {
        let cells: Vec<&str> = record.iter().collect();
        self.encoder.write_row(cells, &mut self.buf)?;
        if self.buf.len() >= IO_SLICE {
            self.sink.write_all(&self.buf)?;
            self.buf.clear();
        }
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<()> {
        self.sink.write_all(&self.buf)?;
        self.buf.clear();
        self.sink.flush()?;
        if let Some(path) = &self.dest {
            let tmp = PathBuf::from(format!("{}.part", path.display()));
            fs::rename(&tmp, path).with_context(|| format!("move {tmp:?} -> {path:?}"))?;
        }
        self.committed = true;
        Ok(())
    }
}
