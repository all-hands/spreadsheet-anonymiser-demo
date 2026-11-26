use crate::policy::{Generalisation, REDACTED};
use crate::Error;
use std::fmt;
use std::str::FromStr;

pub const DEFAULT_WIDTH: u32 = 10;

pub const AGE_TOP: u32 = 90;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Date(jiff::civil::Date);

impl Date {
    pub fn new(year: u16, month: u8, day: u8) -> Option<Date> {
        if !(1..=9999).contains(&year) {
            return None;
        }
        let date = jiff::civil::Date::new(
            i16::try_from(year).ok()?,
            i8::try_from(month).ok()?,
            i8::try_from(day).ok()?,
        )
        .ok()?;
        Some(Date(date))
    }

    pub fn year(self) -> u16 {
        u16::try_from(self.0.year()).expect("constructed within 1..=9999")
    }

    pub fn age_on(self, on: Date) -> Option<u32> {
        if on < self {
            return None;
        }
        let had_birthday = (on.0.month(), on.0.day()) >= (self.0.month(), self.0.day());
        let years = i32::from(on.0.year()) - i32::from(self.0.year()) - i32::from(!had_birthday);
        u32::try_from(years).ok()
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:04}-{:02}-{:02}",
            self.0.year(),
            self.0.month(),
            self.0.day()
        )
    }
}

impl FromStr for Date {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.len() == 10 {
            if let Some(d) = parse_ymd(s, '-') {
                return Ok(d);
            }
        }
        Err(Error::InvalidParam(format!(
            "reference date {s:?} is not a valid yyyy-mm-dd date"
        )))
    }
}

fn parse_ymd(s: &str, sep: char) -> Option<Date> {
    let mut parts = s.split(sep);
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let digits = |t: &str| t.bytes().all(|c| c.is_ascii_digit());
    if !(digits(y) && digits(m) && digits(d)) {
        return None;
    }
    Date::new(y.parse().ok()?, m.parse().ok()?, d.parse().ok()?)
}

pub fn parse_cell_date(cell: &str) -> Option<Date> {
    let s = cell.trim();
    let head = s.get(..10)?;
    let rest = &s[10..];
    if !rest.is_empty() {
        let mut it = rest.chars();
        let sep = it.next()?;
        if !((sep == 'T' || sep == ' ') && it.next().is_some_and(|c| c.is_ascii_digit())) {
            return None;
        }
    }
    let sep = match head.as_bytes()[4] {
        b'-' => '-',
        b'/' => '/',
        b'.' => '.',
        _ => return None,
    };
    parse_ymd(head, sep)
}

pub fn year_of(cell: &str) -> Option<String> {
    parse_cell_date(cell).map(|d| format!("{:04}", d.year()))
}

fn band_label(lo: i128, width: u32) -> Option<String> {
    if width == 1 {
        return Some(lo.to_string());
    }
    let hi = lo.checked_add(i128::from(width) - 1)?;
    Some(format!("{lo}-{hi}"))
}

pub fn age_band(cell: &str, width: u32, reference: Date) -> Option<String> {
    if width == 0 {
        return None;
    }
    let age = parse_cell_date(cell)?.age_on(reference)?;
    let top = (AGE_TOP / width) * width;
    if age >= top {
        return Some(format!("{top}+"));
    }
    band_label(i128::from((age / width) * width), width)
}

fn parse_floor(cell: &str) -> Option<i128> {
    let s = cell.trim();
    let (neg, body) = match s.as_bytes().first()? {
        b'-' => (true, &s[1..]),
        b'+' => (false, &s[1..]),
        _ => (false, s),
    };
    let (int, frac) = body.split_once('.').unwrap_or((body, "0"));
    let all_digits = |t: &str| !t.is_empty() && t.bytes().all(|c| c.is_ascii_digit());
    if !(all_digits(int) && all_digits(frac)) {
        return None;
    }
    let n: i128 = int.parse().ok()?;
    if !neg {
        return Some(n);
    }
    let has_frac = frac.bytes().any(|c| c != b'0');
    (-n).checked_sub(i128::from(has_frac))
}

pub fn bucket(cell: &str, width: u32) -> Option<String> {
    if width == 0 {
        return None;
    }
    let w = i128::from(width);
    band_label(parse_floor(cell)?.div_euclid(w).checked_mul(w)?, width)
}

pub(crate) fn apply_generalisation(value: &str, kind: Generalisation) -> Result<String, Error> {
    if value.trim().is_empty() {
        return Ok(value.to_string());
    }
    let out = match kind {
        Generalisation::Year => year_of(value),
        Generalisation::AgeBand { width, reference } => {
            let reference = reference.ok_or(Error::MissingReferenceDate)?;
            age_band(value, width, reference)
        }
        Generalisation::Bucket { width } => bucket(value, width),
    };
    Ok(out.unwrap_or_else(|| REDACTED.to_string()))
}

#[cfg(test)]
mod tests;
