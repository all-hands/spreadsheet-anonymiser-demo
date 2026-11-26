use super::{Row, RowSink, TableError, TableFormat};
use csv_core::{ReadRecordResult, Reader, ReaderBuilder, WriteResult, Writer, WriterBuilder};

const BOM: char = '\u{feff}';

pub(super) struct Decoder {
    format: TableFormat,
    rdr: Reader,
    head: Vec<u8>,
    started: bool,
    out: Vec<u8>,
    outlen: usize,
    ends: Vec<usize>,
    endlen: usize,
    headers: Option<Vec<String>>,
    records: u64,
}

impl Decoder {
    pub(super) fn new(format: TableFormat) -> Self {
        Decoder {
            format,
            rdr: ReaderBuilder::new().delimiter(format.delimiter()).build(),
            head: Vec::new(),
            started: false,
            out: vec![0; 4096],
            outlen: 0,
            ends: vec![0; 64],
            endlen: 0,
            headers: None,
            records: 0,
        }
    }

    pub(super) fn headers(&self) -> Option<&[String]> {
        self.headers.as_deref()
    }

    pub(super) fn push(&mut self, input: &[u8], sink: &mut impl RowSink) -> Result<(), TableError> {
        if !self.started {
            self.head.extend_from_slice(input);
            if self.head.len() < 3 {
                return Ok(());
            }
            self.started = true;
            let head = std::mem::take(&mut self.head);
            return self.feed(&head, sink);
        }
        self.feed(input, sink)
    }

    fn feed(&mut self, mut input: &[u8], sink: &mut impl RowSink) -> Result<(), TableError> {
        while !input.is_empty() {
            let (res, nin, nout, nend) = self.rdr.read_record(
                input,
                &mut self.out[self.outlen..],
                &mut self.ends[self.endlen..],
            );
            input = &input[nin..];
            self.outlen += nout;
            self.endlen += nend;
            match res {
                ReadRecordResult::InputEmpty => {}
                ReadRecordResult::OutputFull => self.grow_out(),
                ReadRecordResult::OutputEndsFull => self.grow_ends(),
                ReadRecordResult::Record => self.complete(false, sink)?,
                ReadRecordResult::End => return Ok(()),
            }
        }
        Ok(())
    }

    pub(super) fn finish(&mut self, sink: &mut impl RowSink) -> Result<(), TableError> {
        if !self.started {
            self.started = true;
            let head = std::mem::take(&mut self.head);
            self.feed(&head, sink)?;
        }
        loop {
            let (res, _, nout, nend) = self.rdr.read_record(
                &[],
                &mut self.out[self.outlen..],
                &mut self.ends[self.endlen..],
            );
            self.outlen += nout;
            self.endlen += nend;
            match res {
                ReadRecordResult::OutputFull => self.grow_out(),
                ReadRecordResult::OutputEndsFull => self.grow_ends(),
                ReadRecordResult::Record => self.complete(true, sink)?,
                ReadRecordResult::InputEmpty | ReadRecordResult::End => return Ok(()),
            }
        }
    }

    #[cfg(test)]
    pub(super) fn buffer_bytes(&self) -> usize {
        self.out.len() + self.ends.len() * std::mem::size_of::<usize>() + self.head.len()
    }

    fn grow_out(&mut self) {
        let n = self.out.len() * 2;
        self.out.resize(n, 0);
    }

    fn grow_ends(&mut self) {
        let n = self.ends.len() * 2;
        self.ends.resize(n, 0);
    }

    fn complete(&mut self, at_eof: bool, sink: &mut impl RowSink) -> Result<(), TableError> {
        let (outlen, endlen) = (self.outlen, self.endlen);
        self.outlen = 0;
        self.endlen = 0;
        let line = self.rdr.line().saturating_sub(u64::from(!at_eof)).max(1);
        let format = self.format.label();
        let ends = &self.ends[..endlen];
        if let Some(headers) = &self.headers {
            self.records += 1;
            if ends.len() != headers.len() {
                return Err(TableError::UnequalLengths {
                    format,
                    record: self.records,
                    line,
                    expected: headers.len(),
                    found: ends.len(),
                });
            }
        }
        let text = std::str::from_utf8(&self.out[..outlen])
            .map_err(|_| TableError::InvalidUtf8 { format, line })?;
        let row = Row::new(text, ends);
        if self.headers.is_some() {
            sink.row(row);
            return Ok(());
        }
        let mut headers: Vec<String> = row.iter().map(str::to_owned).collect();
        if let Some(first) = headers.first_mut() {
            if let Some(rest) = first.strip_prefix(BOM) {
                *first = rest.to_owned();
            }
        }
        sink.headers(&headers);
        self.headers = Some(headers);
        Ok(())
    }
}

pub(super) fn writer(format: TableFormat) -> Writer {
    WriterBuilder::new().delimiter(format.delimiter()).build()
}

fn put(out: &mut Vec<u8>, room: usize, step: impl FnOnce(&mut [u8]) -> (WriteResult, usize)) {
    let start = out.len();
    out.resize(start + room, 0);
    let (res, n) = step(&mut out[start..]);
    debug_assert!(res == WriteResult::InputEmpty, "room was enough");
    out.truncate(start + n);
}

pub(super) fn write_record<'c, I>(w: &mut Writer, fields: I, out: &mut Vec<u8>)
where
    I: Iterator<Item = &'c str> + Clone,
{
    let term: &[u8] = match w.get_terminator() {
        csv_core::Terminator::CRLF => b"\r\n",
        csv_core::Terminator::Any(b'\n') => b"\n",
        _ => &[],
    };
    if !term.is_empty() && fields.clone().any(|f| !f.is_empty()) {
        for (i, field) in fields.enumerate() {
            if i > 0 {
                out.push(w.get_delimiter());
            }
            let field = field.as_bytes();
            if !w.should_quote(field) {
                out.extend_from_slice(field);
                continue;
            }
            let q = w.get_quote();
            out.push(q);
            put(out, 2 * field.len(), |o| {
                let (res, _, n) =
                    csv_core::quote(field, o, q, w.get_escape(), w.get_double_quote());
                (res, n)
            });
            out.push(q);
        }
        out.extend_from_slice(term);
        return;
    }
    write_record_slow(w, fields, out);
}

fn write_record_slow<'c>(w: &mut Writer, fields: impl Iterator<Item = &'c str>, out: &mut Vec<u8>) {
    let mut any = false;
    for field in fields {
        if any {
            put(out, 2, |o| w.delimiter(o));
        }
        any = true;
        put(out, 2 * field.len() + 1, |o| {
            let (res, _, n) = w.field(field.as_bytes(), o);
            (res, n)
        });
    }
    if !any {
        out.push(b'\n');
        return;
    }
    put(out, 4, |o| w.terminator(o));
}
