use anonymiser_core::{Row, RowSink, TableError, TableFormat};
use wasm_bindgen::prelude::*;

fn js_err(e: TableError) -> JsError {
    JsError::new(&e.to_string())
}

fn utf16_len(s: &str) -> usize {
    if s.is_ascii() {
        return s.len();
    }
    s.bytes()
        .map(|b| usize::from(b & 0xc0 != 0x80) + usize::from(b >= 0xf0))
        .sum()
}

#[derive(Default)]
struct Packed {
    text: String,
    ends: Vec<u32>,
    units: usize,
    rows: u32,
    headers: Option<Vec<String>>,
}

impl RowSink for Packed {
    fn headers(&mut self, headers: &[String]) {
        self.headers = Some(headers.to_vec());
    }
    fn row(&mut self, row: Row<'_>) {
        let concat = row.concat();
        self.text.push_str(concat);
        if concat.is_ascii() {
            let base = self.units;
            self.ends
                .extend(row.ends().iter().map(|&e| (base + e) as u32));
            self.units += concat.len();
        } else {
            for cell in row.iter() {
                self.units += utf16_len(cell);
                self.ends.push(self.units as u32);
            }
        }
        self.rows += 1;
    }
}

#[wasm_bindgen]
pub struct TableDecoder {
    inner: anonymiser_core::TableDecoder,
    packed: Packed,
}

impl TableDecoder {
    fn create(format: &str) -> Result<TableDecoder, TableError> {
        Ok(TableDecoder {
            inner: anonymiser_core::TableDecoder::new(format.parse()?),
            packed: Packed::default(),
        })
    }

    fn decode(&mut self, utf8: &[u8], last: bool) -> Result<String, TableError> {
        let p = &mut self.packed;
        p.ends.clear();
        p.units = 0;
        p.rows = 0;
        let res =
            self.inner.push(utf8, p).and_then(
                |()| {
                    if last {
                        self.inner.finish(p)
                    } else {
                        Ok(())
                    }
                },
            );
        let cells = std::mem::take(&mut p.text);
        res.map(|()| cells)
    }
}

#[wasm_bindgen]
impl TableDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(format: &str) -> Result<TableDecoder, JsError> {
        TableDecoder::create(format).map_err(js_err)
    }

    pub fn push(&mut self, utf8: &[u8], last: bool) -> Result<String, JsError> {
        self.decode(utf8, last).map_err(js_err)
    }

    pub fn cell_ends(&self) -> Vec<u32> {
        self.packed.ends.clone()
    }

    pub fn row_count(&self) -> u32 {
        self.packed.rows
    }

    pub fn headers(&self) -> Option<Vec<String>> {
        self.packed.headers.clone()
    }
}

#[wasm_bindgen]
pub fn encode_table_header(format: &str, headers: Vec<String>) -> Result<Vec<u8>, JsError> {
    encode_header(format, headers).map_err(js_err)
}

#[wasm_bindgen]
pub fn encode_table_rows(
    format: &str,
    headers: Vec<String>,
    cells: &[u8],
    cell_ends: &[u32],
    row_ends: &[u32],
) -> Result<Vec<u8>, JsError> {
    encode_rows(format, headers, cells, cell_ends, row_ends).map_err(|e| JsError::new(&e))
}

fn encode_header(format: &str, headers: Vec<String>) -> Result<Vec<u8>, TableError> {
    let mut enc = anonymiser_core::TableEncoder::new(format.parse()?, headers);
    let mut out = Vec::new();
    enc.write_header(&mut out);
    Ok(out)
}

fn byte_offsets(s: &str, units: &[u32]) -> Option<Vec<usize>> {
    if s.is_ascii() {
        return units
            .iter()
            .map(|&u| (u as usize <= s.len()).then_some(u as usize))
            .collect();
    }
    let mut out = Vec::with_capacity(units.len());
    let mut want = units.iter().copied().peekable();
    let mut unit = 0u32;
    for (i, c) in s.char_indices().chain(std::iter::once((s.len(), '\0'))) {
        while want.peek() == Some(&unit) {
            out.push(i);
            want.next();
        }
        if want.peek().is_some_and(|&u| u < unit) {
            return None;
        }
        unit += c.len_utf16() as u32;
    }
    (want.next().is_none()).then_some(out)
}

fn encode_rows(
    format: &str,
    headers: Vec<String>,
    cells: &[u8],
    cell_ends: &[u32],
    row_ends: &[u32],
) -> Result<Vec<u8>, String> {
    let format: TableFormat = format.parse().map_err(|e: TableError| e.to_string())?;
    let mut enc = anonymiser_core::TableEncoder::new(format, headers);
    let bad = || "invalid packed rows for the table encoder".to_owned();
    let cells = std::str::from_utf8(cells).map_err(|_| bad())?;
    let ends = byte_offsets(cells, cell_ends).ok_or_else(bad)?;
    let mut out = Vec::with_capacity(cells.len() + cells.len() / 4 + 64);
    let (mut cell, mut start) = (0usize, 0usize);
    for &row_end in row_ends {
        let row_end = row_end as usize;
        let row = ends.get(cell..row_end).ok_or_else(bad)?;
        let mut texts = Vec::with_capacity(row.len());
        for &end in row {
            texts.push(cells.get(start..end).ok_or_else(bad)?);
            start = end;
        }
        enc.write_row(texts, &mut out).map_err(|e| e.to_string())?;
        cell = row_end;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows_text(f: &str, h: Vec<String>, c: &str, e: &[u32], r: &[u32]) -> Result<String, String> {
        encode_rows(f, h, c.as_bytes(), e, r).map(|b| String::from_utf8(b).unwrap())
    }

    fn header_text(f: &str, h: Vec<String>) -> Result<String, TableError> {
        encode_header(f, h).map(|b| String::from_utf8(b).unwrap())
    }

    fn unpack(cells: &str, ends: &[u32], rows: u32) -> Vec<Vec<String>> {
        let units: Vec<u16> = cells.encode_utf16().collect();
        let width = if rows == 0 {
            0
        } else {
            ends.len() / rows as usize
        };
        let mut start = 0;
        let mut out = Vec::new();
        for r in 0..rows as usize {
            let mut row = Vec::new();
            for &e in &ends[r * width..(r + 1) * width] {
                row.push(String::from_utf16(&units[start..e as usize]).unwrap());
                start = e as usize;
            }
            out.push(row);
        }
        out
    }

    fn decode_all(format: &str, pieces: &[&str]) -> (Option<Vec<String>>, Vec<Vec<String>>) {
        let mut d = TableDecoder::create(format).unwrap();
        let mut rows = Vec::new();
        for (i, p) in pieces.iter().enumerate() {
            let cells = d.decode(p.as_bytes(), i + 1 == pieces.len()).unwrap();
            rows.extend(unpack(&cells, &d.packed.ends, d.packed.rows));
        }
        (d.packed.headers.clone(), rows)
    }

    fn pack(rows: &[&[&str]]) -> (String, Vec<u32>, Vec<u32>) {
        let (mut text, mut ends, mut row_ends) = (String::new(), Vec::new(), Vec::new());
        let mut units = 0;
        for r in rows {
            for c in *r {
                text.push_str(c);
                units += c.encode_utf16().count() as u32;
                ends.push(units);
            }
            row_ends.push(ends.len() as u32);
        }
        (text, ends, row_ends)
    }

    #[test]
    fn utf16_lengths_match_js() {
        for s in ["", "abc", "é", "日本", "😀", "a😀é\u{ffff}\u{10000}"] {
            assert_eq!(utf16_len(s), s.encode_utf16().count(), "{s}");
        }
    }

    #[test]
    fn decoded_rows_cross_packed_and_unpack_to_every_character() {
        let weird = "q\"b\\s\n\r\t\u{0}\u{1f}\u{7f}é😀\u{2028}";
        let mut enc =
            anonymiser_core::TableEncoder::new(TableFormat::Csv, vec!["h".into(), "i".into()]);
        let mut text = Vec::new();
        enc.write_header(&mut text);
        enc.write_row([weird, ""], &mut text).unwrap();
        enc.write_row(["😀😀", "x"], &mut text).unwrap();
        let text = String::from_utf8(text).unwrap();
        let (h, rows) = decode_all("csv", &[&text[..5], &text[5..], ""]);
        assert_eq!(h, Some(vec!["h".to_string(), "i".to_string()]));
        assert_eq!(
            rows,
            vec![
                vec![weird.to_string(), String::new()],
                vec!["😀😀".into(), "x".into()]
            ]
        );
    }

    #[test]
    fn zero_width_rows_are_counted() {
        let mut d = TableDecoder::create("jsonl").unwrap();
        assert_eq!(d.decode(b"{}\n{}\n", true).unwrap(), "");
        assert_eq!((d.packed.rows, d.packed.ends.len()), (2, 0));
        assert_eq!(d.packed.headers, Some(vec![]));
    }

    #[test]
    fn decode_errors_are_the_core_errors() {
        let mut d = TableDecoder::create("csv").unwrap();
        let e = d.decode(b"a,b\nSECRET\n", false).unwrap_err();
        assert_eq!(
            e.to_string(),
            "CSV record 1 (line 2): found 1 fields, but the header has 2"
        );
        assert_eq!(d.decode(b"", true).unwrap_err(), TableError::Closed);
        assert!(TableDecoder::create("xlsx").is_err());
    }

    #[test]
    fn packed_rows_encode_through_the_core_encoder() {
        let headers = vec!["a".to_string(), "b".to_string()];
        let (t, e, r) = pack(&[&["x,y", "q\"r"], &["", "é\n😀"], &["😀", ""]]);
        assert_eq!(
            rows_text("csv", headers.clone(), &t, &e, &r).unwrap(),
            "\"x,y\",\"q\"\"r\"\n,\"é\n😀\"\n😀,\n"
        );
        assert_eq!(
            rows_text("jsonl", headers.clone(), &t, &e, &r).unwrap(),
            "{\"a\":\"x,y\",\"b\":\"q\\\"r\"}\n{\"a\":\"\",\"b\":\"é\\n😀\"}\n{\"a\":\"😀\",\"b\":\"\"}\n"
        );
        assert_eq!(header_text("tsv", headers.clone()).unwrap(), "a\tb\n");
        assert_eq!(header_text("jsonl", headers.clone()).unwrap(), "");
        assert_eq!(rows_text("csv", headers.clone(), "", &[], &[]).unwrap(), "");
        let (t, e, r) = pack(&[&["only"]]);
        assert_eq!(
            rows_text("csv", headers.clone(), &t, &e, &r).unwrap_err(),
            "output row 1 has 1 cells, but the header has 2"
        );
        assert_eq!(
            rows_text("jsonl", vec![], "", &[], &[0, 0]).unwrap(),
            "{}\n{}\n"
        );
    }

    #[test]
    fn bad_offsets_are_errors_not_panics() {
        let h = vec!["a".to_string()];
        assert!(rows_text("csv", h.clone(), "abc", &[9], &[1]).is_err());
        assert!(
            rows_text("csv", h.clone(), "😀", &[1], &[1]).is_err(),
            "inside a pair"
        );
        assert!(
            rows_text("csv", h.clone(), "ab", &[2, 1], &[1, 2]).is_err(),
            "descending"
        );
        assert!(rows_text("csv", h, "ab", &[2], &[5]).is_err());
    }
}
