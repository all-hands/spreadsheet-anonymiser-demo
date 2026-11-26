use std::collections::{BTreeMap, HashMap};
use std::str::FromStr;

pub const SUPPRESSED: &str = "*";

pub const MIN_K: usize = 2;

pub const SUPPRESS_MODE_VOCABULARY: &[&str] = &["cells", "rows"];

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AnonymityError {
    #[error("minimum group size must be at least {MIN_K} (1 protects nothing)")]
    KTooSmall,
    #[error("no quasi-identifier columns given")]
    NoQuasiIdentifiers,
    #[error("quasi-identifier column {0} is out of range (the table has {1} columns)")]
    ColumnOutOfRange(usize, usize),
    #[error("quasi-identifier column {0} is listed more than once")]
    DuplicateColumn(usize),
    #[error("row {row} has {got} cells, expected {expected}")]
    RaggedRow {
        row: usize,
        got: usize,
        expected: usize,
    },
    #[error("unknown suppression mode {0:?} (cells|rows)")]
    UnknownMode(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuppressMode {
    Cells,
    Rows,
}

impl SuppressMode {
    pub fn as_str(self) -> &'static str {
        match self {
            SuppressMode::Cells => "cells",
            SuppressMode::Rows => "rows",
        }
    }
}

impl FromStr for SuppressMode {
    type Err = AnonymityError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "cells" => Ok(SuppressMode::Cells),
            "rows" => Ok(SuppressMode::Rows),
            other => Err(AnonymityError::UnknownMode(other.to_string())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnContribution {
    pub column: usize,
    pub rows_below_k_without: usize,
    pub min_group_without: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub k: usize,
    pub rows: usize,
    pub groups: usize,
    pub min_group: usize,
    pub rows_below_k: usize,
    pub per_column: Vec<ColumnContribution>,
}

impl Report {
    pub fn satisfied(&self) -> bool {
        self.rows > 0 && self.rows_below_k == 0
    }
}

impl Report {
    pub fn claim(&self, names: &[&str]) -> String {
        let cols = names.join(", ");
        if self.rows == 0 {
            return format!("No rows to measure on {cols}.");
        }
        if self.satisfied() {
            format!(
                "Measured: every combination of {cols} in this output is shared by at least {} \
                 rows (target k={}). This holds for this file only; it says nothing about \
                 linkage with other data.",
                self.min_group, self.k
            )
        } else {
            format!(
                "Not k-anonymous at k={}: {} of {} rows share their combination of {cols} with \
                 fewer than {} others (smallest group {}).",
                self.k,
                self.rows_below_k,
                self.rows,
                self.k - 1,
                self.min_group
            )
        }
    }
}

#[derive(Default, Clone)]
struct Histogram(BTreeMap<usize, usize>);

impl Histogram {
    fn of(groups: &HashMap<Vec<String>, usize>) -> Histogram {
        let mut h = BTreeMap::new();
        for &size in groups.values() {
            *h.entry(size).or_insert(0) += 1;
        }
        Histogram(h)
    }
    fn groups(&self) -> usize {
        self.0.values().sum()
    }
    fn min(&self) -> usize {
        self.0.keys().next().copied().unwrap_or(0)
    }
    fn rows_below(&self, k: usize) -> usize {
        self.0.range(..k).map(|(&size, &n)| size * n).sum()
    }
}

pub struct Measurer {
    columns: Vec<usize>,
    full: HashMap<Vec<String>, usize>,
    without: Vec<HashMap<Vec<String>, usize>>,
    rows: usize,
}

impl Measurer {
    pub fn new(columns: &[usize]) -> Result<Measurer, AnonymityError> {
        check_columns(columns, None)?;
        Ok(Measurer {
            columns: columns.to_vec(),
            full: HashMap::new(),
            without: vec![HashMap::new(); columns.len()],
            rows: 0,
        })
    }

    pub fn add<S: AsRef<str>>(&mut self, key: &[S]) -> Result<(), AnonymityError> {
        if key.len() != self.columns.len() {
            return Err(AnonymityError::RaggedRow {
                row: self.rows,
                got: key.len(),
                expected: self.columns.len(),
            });
        }
        let owned: Vec<String> = key.iter().map(|s| s.as_ref().to_string()).collect();
        if self.columns.len() > 1 {
            for (i, map) in self.without.iter_mut().enumerate() {
                let mut sub = owned.clone();
                sub.remove(i);
                *map.entry(sub).or_insert(0) += 1;
            }
        } else {
            *self.without[0].entry(Vec::new()).or_insert(0) += 1;
        }
        *self.full.entry(owned).or_insert(0) += 1;
        self.rows += 1;
        Ok(())
    }

    pub fn report(&self, k: usize) -> Result<Report, AnonymityError> {
        if k < MIN_K {
            return Err(AnonymityError::KTooSmall);
        }
        let h = Histogram::of(&self.full);
        Ok(Report {
            k,
            rows: self.rows,
            groups: h.groups(),
            min_group: h.min(),
            rows_below_k: h.rows_below(k),
            per_column: self
                .columns
                .iter()
                .zip(&self.without)
                .map(|(&column, map)| {
                    let w = Histogram::of(map);
                    ColumnContribution {
                        column,
                        rows_below_k_without: w.rows_below(k),
                        min_group_without: w.min(),
                    }
                })
                .collect(),
        })
    }
}

fn check_columns(qi: &[usize], ncols: Option<usize>) -> Result<(), AnonymityError> {
    if qi.is_empty() {
        return Err(AnonymityError::NoQuasiIdentifiers);
    }
    for (i, &c) in qi.iter().enumerate() {
        if let Some(n) = ncols {
            if c >= n {
                return Err(AnonymityError::ColumnOutOfRange(c, n));
            }
        }
        if qi[..i].contains(&c) {
            return Err(AnonymityError::DuplicateColumn(c));
        }
    }
    Ok(())
}

pub fn measure_rows<R: AsRef<[String]>>(
    rows: &[R],
    qi: &[usize],
    k: usize,
) -> Result<Report, AnonymityError> {
    if k < MIN_K {
        return Err(AnonymityError::KTooSmall);
    }
    let ncols = rows.first().map_or(usize::MAX, |r| r.as_ref().len());
    check_columns(qi, rows.first().map(|_| ncols))?;
    let mut m = Measurer::new(qi)?;
    for (n, row) in rows.iter().enumerate() {
        let row = row.as_ref();
        if row.len() != ncols {
            return Err(AnonymityError::RaggedRow {
                row: n,
                got: row.len(),
                expected: ncols,
            });
        }
        let key: Vec<&str> = qi.iter().map(|&c| row[c].as_str()).collect();
        m.add(&key)?;
    }
    m.report(k)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Suppression {
    pub k: usize,
    pub mode: SuppressMode,
    pub rows_in: usize,
    pub rows_suppressed: usize,
    pub cells_suppressed: usize,
    pub rows_dropped: usize,
    pub groups_before: usize,
    pub min_group_before: usize,
    pub groups_after: usize,
    pub min_group_after: usize,
}

pub fn suppress_small_groups(
    rows: &mut Vec<Vec<String>>,
    qi: &[usize],
    k: usize,
    mode: SuppressMode,
) -> Result<Suppression, AnonymityError> {
    if k < MIN_K {
        return Err(AnonymityError::KTooSmall);
    }
    let ncols = rows.first().map(|r| r.len());
    check_columns(qi, ncols)?;
    let ncols = ncols.unwrap_or(0);
    let mut counts: HashMap<Vec<String>, usize> = HashMap::new();
    for (n, row) in rows.iter().enumerate() {
        if row.len() != ncols {
            return Err(AnonymityError::RaggedRow {
                row: n,
                got: row.len(),
                expected: ncols,
            });
        }
        *counts
            .entry(qi.iter().map(|&c| row[c].clone()).collect())
            .or_insert(0) += 1;
    }
    let before = Histogram::of(&counts);
    let rows_in = rows.len();
    let small = |row: &[String]| -> bool {
        let key: Vec<String> = qi.iter().map(|&c| row[c].clone()).collect();
        counts[&key] < k
    };
    let (mut rows_suppressed, mut cells, mut dropped) = (0, 0, 0);
    match mode {
        SuppressMode::Cells => {
            for row in rows.iter_mut() {
                if small(row) {
                    rows_suppressed += 1;
                    for &c in qi {
                        row[c] = SUPPRESSED.to_string();
                        cells += 1;
                    }
                }
            }
        }
        SuppressMode::Rows => {
            rows.retain(|row| {
                let drop = small(row);
                rows_suppressed += usize::from(drop);
                !drop
            });
            dropped = rows_suppressed;
        }
    }
    let kept: HashMap<Vec<String>, usize> = counts.into_iter().filter(|&(_, n)| n >= k).collect();
    let after = Histogram::of(&kept);
    Ok(Suppression {
        k,
        mode,
        rows_in,
        rows_suppressed,
        cells_suppressed: cells,
        rows_dropped: dropped,
        groups_before: before.groups(),
        min_group_before: before.min(),
        groups_after: after.groups(),
        min_group_after: after.min(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(rows: &[&[&str]]) -> Vec<Vec<String>> {
        rows.iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect()
    }

    fn sample() -> Vec<Vec<String>> {
        t(&[
            &["1", "30-39", "Athens"],
            &["2", "30-39", "Athens"],
            &["3", "30-39", "Athens"],
            &["4", "40-49", "Athens"],
            &["5", "40-49", "Patras"],
            &["6", "50-59", "Patras"],
        ])
    }

    #[test]
    fn measures_groups_and_contributions() {
        let r = measure_rows(&sample(), &[1, 2], 2).unwrap();
        assert_eq!(
            (r.rows, r.groups, r.min_group, r.rows_below_k),
            (6, 4, 1, 3)
        );
        assert!(!r.satisfied());
        assert_eq!(
            r.per_column[0],
            ColumnContribution {
                column: 1,
                rows_below_k_without: 0,
                min_group_without: 2
            }
        );
        assert_eq!(
            r.per_column[1],
            ColumnContribution {
                column: 2,
                rows_below_k_without: 1,
                min_group_without: 1
            }
        );
    }

    #[test]
    fn single_column_without_is_one_group() {
        let r = measure_rows(&sample(), &[2], 4).unwrap();
        assert_eq!((r.groups, r.min_group, r.rows_below_k), (2, 2, 2));
        assert_eq!(r.per_column[0].rows_below_k_without, 0);
        assert_eq!(r.per_column[0].min_group_without, 6);
        assert_eq!(
            measure_rows(&sample(), &[2], 7).unwrap().per_column[0].rows_below_k_without,
            6
        );
    }

    #[test]
    fn streaming_equals_batch() {
        let rows = sample();
        let mut m = Measurer::new(&[1, 2]).unwrap();
        for r in &rows {
            m.add(&[&r[1], &r[2]]).unwrap();
        }
        assert_eq!(
            m.report(3).unwrap(),
            measure_rows(&rows, &[1, 2], 3).unwrap()
        );
    }

    #[test]
    fn empty_table_and_refusals() {
        let none: Vec<Vec<String>> = vec![];
        let r = measure_rows(&none, &[0], 2).unwrap();
        assert_eq!((r.rows, r.groups, r.min_group), (0, 0, 0));
        assert!(!r.satisfied());
        assert_eq!(
            measure_rows(&sample(), &[1], 1),
            Err(AnonymityError::KTooSmall)
        );
        assert_eq!(
            measure_rows(&sample(), &[], 2),
            Err(AnonymityError::NoQuasiIdentifiers)
        );
        assert_eq!(
            measure_rows(&sample(), &[1, 1], 2),
            Err(AnonymityError::DuplicateColumn(1))
        );
        assert_eq!(
            measure_rows(&sample(), &[3], 2),
            Err(AnonymityError::ColumnOutOfRange(3, 3))
        );
        let mut ragged = sample();
        ragged[2].pop();
        assert!(matches!(
            measure_rows(&ragged, &[1], 2),
            Err(AnonymityError::RaggedRow {
                row: 2,
                got: 2,
                expected: 3
            })
        ));
    }

    #[test]
    fn cell_suppression_blanks_only_small_groups() {
        let mut rows = sample();
        let s = suppress_small_groups(&mut rows, &[1, 2], 2, SuppressMode::Cells).unwrap();
        assert_eq!(rows[0], ["1", "30-39", "Athens"]);
        assert_eq!(rows[3], ["4", "*", "*"]);
        assert_eq!(rows[5], ["6", "*", "*"]);
        assert_eq!(rows[3][0], "4");
        assert_eq!(
            (s.rows_suppressed, s.cells_suppressed, s.rows_dropped),
            (3, 6, 0)
        );
        assert_eq!((s.groups_before, s.min_group_before), (4, 1));
        assert_eq!((s.groups_after, s.min_group_after), (1, 3));
    }

    #[test]
    fn row_suppression_drops_and_keeps_order() {
        let mut rows = sample();
        let s = suppress_small_groups(&mut rows, &[1, 2], 2, SuppressMode::Rows).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[2][0], "3");
        assert_eq!(
            (
                s.rows_in,
                s.rows_suppressed,
                s.rows_dropped,
                s.cells_suppressed
            ),
            (6, 3, 3, 0)
        );
        assert!(measure_rows(&rows, &[1, 2], 2).unwrap().satisfied());
    }

    #[test]
    fn nothing_to_suppress_and_everything_to_suppress() {
        let mut rows = sample();
        let before = rows.clone();
        let s = suppress_small_groups(&mut rows, &[1], 1 + 1, SuppressMode::Cells).unwrap();
        assert_eq!(s.rows_suppressed, 1);
        let mut same = before.clone();
        let s = suppress_small_groups(&mut same, &[2], 2, SuppressMode::Cells).unwrap();
        assert_eq!(same, before);
        assert_eq!((s.rows_suppressed, s.min_group_after), (0, 2));
        let mut all = sample();
        let s = suppress_small_groups(&mut all, &[1, 2], 7, SuppressMode::Rows).unwrap();
        assert!(all.is_empty());
        assert_eq!((s.groups_after, s.min_group_after), (0, 0));
    }

    #[test]
    fn suppression_is_deterministic() {
        let (mut a, mut b) = (sample(), sample());
        suppress_small_groups(&mut a, &[1, 2], 2, SuppressMode::Cells).unwrap();
        suppress_small_groups(&mut b, &[2, 1], 2, SuppressMode::Cells).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn claim_wording() {
        let mut rows = sample();
        let bad = measure_rows(&rows, &[1, 2], 2)
            .unwrap()
            .claim(&["age", "city"]);
        assert_eq!(
            bad,
            "Not k-anonymous at k=2: 3 of 6 rows share their combination of age, city with \
             fewer than 1 others (smallest group 1)."
        );
        suppress_small_groups(&mut rows, &[1, 2], 2, SuppressMode::Rows).unwrap();
        let ok = measure_rows(&rows, &[1, 2], 2)
            .unwrap()
            .claim(&["age", "city"]);
        assert!(ok.starts_with("Measured: every combination of age, city"));
        assert!(!ok.contains("anonymous"));
    }

    #[test]
    fn mode_parses_its_vocabulary_only() {
        for m in SUPPRESS_MODE_VOCABULARY {
            assert_eq!(m.parse::<SuppressMode>().unwrap().as_str(), *m);
        }
        assert!("Cells".parse::<SuppressMode>().is_err());
    }
}
