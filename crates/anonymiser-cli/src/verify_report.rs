use crate::manifest_check;
use anyhow::Result;
use std::path::Path;

#[derive(Clone, Copy)]
pub(crate) enum Severity {
    Ok,
    Warn,
    Fail,
}

impl Severity {
    pub(crate) fn mark(self) -> &'static str {
        match self {
            Severity::Ok => "✓",
            Severity::Warn => "⚠",
            Severity::Fail => "✗",
        }
    }
}

pub(crate) fn emit(checks: &[manifest_check::Check]) -> usize {
    for c in checks {
        let sev = if c.ok { Severity::Ok } else { Severity::Fail };
        println!("{} {}", sev.mark(), c.msg);
    }
    checks.iter().filter(|c| !c.ok).count()
}

pub(crate) fn read_table(path: &Path) -> Result<(csv::StringRecord, Vec<csv::StringRecord>)> {
    let format = crate::io::infer_format(path);
    let mut rdr = crate::io::TableReader::open(path, format)?;
    let headers = rdr.headers().clone();
    let mut rows = Vec::new();
    while let Some(r) = rdr.next_record()? {
        rows.push(r);
    }
    Ok((headers, rows))
}
