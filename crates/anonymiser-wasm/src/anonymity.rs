use anonymiser_core::{AnonymityError, Measurer, Report, SuppressMode, Suppression};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

fn js_err(e: impl ToString) -> JsError {
    JsError::new(&e.to_string())
}

fn bad_json(what: &str, e: serde_json::Error) -> String {
    format!("{what} is not valid JSON of the expected shape: {e}")
}

fn parse_rows(json: &str) -> Result<Vec<Vec<String>>, String> {
    serde_json::from_str(json).map_err(|e| bad_json("rows", e))
}

fn parse_qi(json: &str) -> Result<Vec<usize>, String> {
    serde_json::from_str(json).map_err(|e| bad_json("quasi-identifiers", e))
}

fn report_json(r: &Report) -> Value {
    json!({
        "k": r.k,
        "rows": r.rows,
        "groups": r.groups,
        "min_group": r.min_group,
        "rows_below_k": r.rows_below_k,
        "satisfied": r.satisfied(),
        "per_column": r.per_column.iter().map(|c| json!({
            "column": c.column,
            "rows_below_k_without": c.rows_below_k_without,
            "min_group_without": c.min_group_without,
        })).collect::<Vec<_>>(),
    })
}

fn suppression_json(s: &Suppression) -> Value {
    json!({
        "k": s.k,
        "mode": s.mode.as_str(),
        "rows_in": s.rows_in,
        "rows_suppressed": s.rows_suppressed,
        "cells_suppressed": s.cells_suppressed,
        "rows_dropped": s.rows_dropped,
        "groups_before": s.groups_before,
        "min_group_before": s.min_group_before,
        "groups_after": s.groups_after,
        "min_group_after": s.min_group_after,
    })
}

fn measure(rows_json: &str, qi_json: &str, k: u32) -> Result<String, String> {
    let mut m = AnonymityMeter::create(qi_json)?;
    m.add_json(rows_json)?;
    m.report_for(k)
}

fn suppress(rows_json: &str, qi_json: &str, k: u32, mode: &str) -> Result<String, String> {
    let mut rows: Vec<Vec<String>> = parse_rows(rows_json)?;
    let qi: Vec<usize> = parse_qi(qi_json)?;
    let mode: SuppressMode = mode.parse().map_err(|e: AnonymityError| e.to_string())?;
    let s = anonymiser_core::suppress_small_groups(&mut rows, &qi, k as usize, mode)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "rows": rows, "suppression": suppression_json(&s) }).to_string())
}

fn claim(report_json: &str, names_json: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(report_json).map_err(|e| bad_json("report", e))?;
    let num = |key: &str| -> Result<usize, String> {
        v[key]
            .as_u64()
            .map(|n| n as usize)
            .ok_or_else(|| format!("report has no numeric {key:?}"))
    };
    let names: Vec<String> = serde_json::from_str(names_json).map_err(|e| bad_json("names", e))?;
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let r = Report {
        k: num("k")?,
        rows: num("rows")?,
        groups: num("groups")?,
        min_group: num("min_group")?,
        rows_below_k: num("rows_below_k")?,
        per_column: Vec::new(),
    };
    if r.k < anonymiser_core::MIN_K {
        return Err(AnonymityError::KTooSmall.to_string());
    }
    Ok(r.claim(&names))
}

#[wasm_bindgen]
pub struct AnonymityMeter {
    inner: Measurer,
    qi: Vec<usize>,
}

impl AnonymityMeter {
    fn create(qi_json: &str) -> Result<AnonymityMeter, String> {
        let qi: Vec<usize> = parse_qi(qi_json)?;
        let inner = Measurer::new(&qi).map_err(|e| e.to_string())?;
        Ok(AnonymityMeter { inner, qi })
    }
}

impl AnonymityMeter {
    fn add_json(&mut self, rows_json: &str) -> Result<(), String> {
        let rows: Vec<Vec<String>> = parse_rows(rows_json)?;
        for row in &rows {
            let key = self
                .qi
                .iter()
                .map(|&c| {
                    row.get(c)
                        .map(String::as_str)
                        .ok_or_else(|| AnonymityError::ColumnOutOfRange(c, row.len()).to_string())
                })
                .collect::<Result<Vec<&str>, String>>()?;
            self.inner.add(&key).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn report_for(&self, k: u32) -> Result<String, String> {
        let r = self.inner.report(k as usize).map_err(|e| e.to_string())?;
        Ok(report_json(&r).to_string())
    }
}

#[wasm_bindgen]
impl AnonymityMeter {
    #[wasm_bindgen(constructor)]
    pub fn new(qi_json: &str) -> Result<AnonymityMeter, JsError> {
        AnonymityMeter::create(qi_json).map_err(js_err)
    }

    pub fn add_rows(&mut self, rows_json: &str) -> Result<(), JsError> {
        self.add_json(rows_json).map_err(js_err)
    }

    pub fn report(&self, k: u32) -> Result<String, JsError> {
        self.report_for(k).map_err(js_err)
    }
}

#[wasm_bindgen]
pub fn k_anonymity_measure(rows_json: &str, qi_json: &str, k: u32) -> Result<String, JsError> {
    measure(rows_json, qi_json, k).map_err(js_err)
}

#[wasm_bindgen]
pub fn k_anonymity_suppress(
    rows_json: &str,
    qi_json: &str,
    k: u32,
    mode: &str,
) -> Result<String, JsError> {
    suppress(rows_json, qi_json, k, mode).map_err(js_err)
}

#[wasm_bindgen]
pub fn k_anonymity_claim(report_json: &str, names_json: &str) -> Result<String, JsError> {
    claim(report_json, names_json).map_err(js_err)
}

#[wasm_bindgen]
pub fn suppress_mode_vocabulary() -> Vec<String> {
    anonymiser_core::SUPPRESS_MODE_VOCABULARY
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[wasm_bindgen]
pub fn suppressed_cell_marker() -> String {
    anonymiser_core::SUPPRESSED.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROWS: &str = r#"[["1","30-39","Athens"],["2","30-39","Athens"],["3","40-49","Athens"],["4","40-49","Patras"],["5","50-59","Patras"]]"#;

    #[test]
    fn measure_json_shape_and_streaming_agree() {
        let one = measure(ROWS, "[1,2]", 2).unwrap();
        let v: Value = serde_json::from_str(&one).unwrap();
        assert_eq!(v["rows"], 5);
        assert_eq!(v["groups"], 4);
        assert_eq!(v["min_group"], 1);
        assert_eq!(v["rows_below_k"], 3);
        assert_eq!(v["satisfied"], false);
        assert_eq!(v["per_column"][0]["column"], 1);

        let mut m = AnonymityMeter::create("[1,2]").unwrap();
        let rows: Vec<Vec<String>> = serde_json::from_str(ROWS).unwrap();
        m.add_json(&serde_json::to_string(&rows[..2]).unwrap())
            .unwrap();
        m.add_json(&serde_json::to_string(&rows[2..]).unwrap())
            .unwrap();
        assert_eq!(m.report_for(2).unwrap(), one);
    }

    #[test]
    fn suppress_json_and_claim() {
        let out = suppress(ROWS, "[1,2]", 2, "cells").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["rows"][2], json!(["3", "*", "*"]));
        assert_eq!(v["suppression"]["rows_suppressed"], 3);
        assert_eq!(v["suppression"]["min_group_after"], 2);

        let rows = suppress(ROWS, "[1,2]", 2, "rows").unwrap();
        let v: Value = serde_json::from_str(&rows).unwrap();
        assert_eq!(v["rows"].as_array().unwrap().len(), 2);

        let rep = measure(ROWS, "[1,2]", 2).unwrap();
        assert!(claim(&rep, r#"["age","city"]"#)
            .unwrap()
            .starts_with("Not k-anonymous at k=2"));
    }

    #[test]
    fn errors_are_the_core_texts() {
        assert_eq!(
            measure(ROWS, "[1]", 1).unwrap_err(),
            "minimum group size must be at least 2 (1 protects nothing)"
        );
        assert_eq!(
            measure(ROWS, "[]", 2).unwrap_err(),
            "no quasi-identifier columns given"
        );
        assert_eq!(
            measure(ROWS, "[9]", 2).unwrap_err(),
            "quasi-identifier column 9 is out of range (the table has 3 columns)"
        );
        assert_eq!(
            suppress(ROWS, "[1]", 2, "blur").unwrap_err(),
            "unknown suppression mode \"blur\" (cells|rows)"
        );
        assert!(measure("nope", "[1]", 2)
            .unwrap_err()
            .starts_with("rows is not valid JSON"));
    }
}
