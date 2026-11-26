pub(crate) fn looks_like_email(v: &str) -> bool {
    let Some((local, domain)) = v.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && !v.contains(' ')
        && !local.contains('@')
}

pub(crate) fn looks_like_phone(v: &str) -> bool {
    let stripped: String = v
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '(' | ')' | '.'))
        .collect();
    let digits = stripped.strip_prefix('+').unwrap_or(&stripped);
    digits.len() >= 10 && digits.chars().all(|c| c.is_ascii_digit())
}

pub(crate) fn scan_kept(
    headers: &csv::StringRecord,
    rows: &[csv::StringRecord],
    kept: &[usize],
) -> Vec<String> {
    let mut pii = Vec::new();
    for &i in kept {
        let (e, p) = rows.iter().fold((0, 0), |(e, p), r| {
            let v = r.get(i).unwrap_or_default();
            (
                e + looks_like_email(v) as usize,
                p + looks_like_phone(v) as usize,
            )
        });
        let name = headers.get(i).unwrap_or("?");
        if e > 0 {
            pii.push(format!("{name}: {e} email-like values"));
        }
        if p > 0 {
            pii.push(format!("{name}: {p} phone-like values"));
        }
    }
    pii
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_match_the_documented_shapes() {
        assert!(looks_like_email("a@b.com"));
        assert!(!looks_like_email("a@b"), "domain needs a dot");
        assert!(!looks_like_email("not an email"), "spaces reject");
        assert!(looks_like_phone("+44 161 1234567"));
        assert!(looks_like_phone("(210) 123-4567"));
        assert!(!looks_like_phone("123-45"), "too few digits");
        assert!(!looks_like_phone("9.8"));
    }
}
