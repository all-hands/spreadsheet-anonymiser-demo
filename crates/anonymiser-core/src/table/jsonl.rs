use super::{Row, RowSink, TableError};
use serde_json::Value;
use std::fmt::Write as _;

pub(super) struct Decoder {
    carry: Vec<u8>,
    line: u64,
    headers: Option<Vec<String>>,
    text: String,
    ends: Vec<usize>,
}

impl Decoder {
    pub(super) fn new() -> Self {
        Decoder {
            carry: Vec::new(),
            line: 0,
            headers: None,
            text: String::new(),
            ends: Vec::new(),
        }
    }

    pub(super) fn headers(&self) -> Option<&[String]> {
        self.headers.as_deref()
    }

    pub(super) fn push(&mut self, input: &[u8], sink: &mut impl RowSink) -> Result<(), TableError> {
        let mut rest = input;
        while let Some(i) = rest.iter().position(|&b| b == b'\n') {
            if self.carry.is_empty() {
                self.line(&rest[..i], sink)?;
            } else {
                let mut line = std::mem::take(&mut self.carry);
                line.extend_from_slice(&rest[..i]);
                self.line(&line, sink)?;
                line.clear();
                self.carry = line;
            }
            rest = &rest[i + 1..];
        }
        self.carry.extend_from_slice(rest);
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn carry_len(&self) -> usize {
        self.carry.len()
    }

    pub(super) fn finish(&mut self, sink: &mut impl RowSink) -> Result<(), TableError> {
        let line = std::mem::take(&mut self.carry);
        if !line.is_empty() {
            self.line(&line, sink)?;
        }
        Ok(())
    }

    fn line(&mut self, bytes: &[u8], sink: &mut impl RowSink) -> Result<(), TableError> {
        self.line += 1;
        let line = self.line;
        let text = std::str::from_utf8(bytes).map_err(|_| TableError::InvalidUtf8 {
            format: "JSONL",
            line,
        })?;
        if text
            .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
            .is_empty()
        {
            return Ok(());
        }
        let value: Value = serde_json::from_str(text).map_err(|e| json_error(&e, line))?;
        let Value::Object(obj) = value else {
            return Err(TableError::NotAnObject { line });
        };
        let fresh = self.headers.is_none();
        let headers = match &self.headers {
            Some(headers) => {
                if let Some(key) = obj.keys().find(|k| headers.binary_search(k).is_err()) {
                    return Err(TableError::UnknownKey {
                        line,
                        headers: headers.clone(),
                        key: key.clone(),
                    });
                }
                headers
            }
            None => {
                let mut keys: Vec<String> = obj.keys().cloned().collect();
                keys.sort_unstable();
                keys.dedup();
                self.headers.insert(keys)
            }
        };
        self.text.clear();
        self.ends.clear();
        for h in headers {
            match obj.get(h) {
                None | Some(Value::Null) => {}
                Some(Value::String(s)) => self.text.push_str(s),
                Some(Value::Bool(b)) => self.text.push_str(if *b { "true" } else { "false" }),
                Some(Value::Number(n)) => {
                    let _ = write!(self.text, "{n}");
                }
                Some(Value::Array(_) | Value::Object(_)) => {
                    return Err(TableError::Nested { line });
                }
            }
            self.ends.push(self.text.len());
        }
        if fresh {
            sink.headers(headers);
        }
        sink.row(Row::new(&self.text, &self.ends));
        Ok(())
    }
}

fn json_error(e: &serde_json::Error, line: u64) -> TableError {
    let full = e.to_string();
    let suffix = format!(" at line {} column {}", e.line(), e.column());
    let reason = full.strip_suffix(&suffix).unwrap_or(&full).to_owned();
    TableError::Json {
        line,
        column: e.column(),
        reason,
    }
}

pub(super) fn write_record<'c>(
    headers: &[String],
    cells: impl Iterator<Item = &'c str>,
    out: &mut Vec<u8>,
) {
    out.push(b'{');
    for (i, (h, c)) in headers.iter().zip(cells).enumerate() {
        if i > 0 {
            out.push(b',');
        }
        escaped(out, h);
        out.push(b':');
        escaped(out, c);
    }
    out.extend_from_slice(b"}\n");
}

pub(crate) fn escaped(out: &mut Vec<u8>, s: &str) {
    let _ = serde_json::to_writer(out, s);
}
