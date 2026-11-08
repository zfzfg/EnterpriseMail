use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SubjectSplit {
    pub subject: String,
    pub body: String,
}

pub fn split_subject(text: &str, want_subject: bool) -> SubjectSplit {
    static SUBJECT: OnceLock<Regex> = OnceLock::new();
    let regex = SUBJECT.get_or_init(|| {
        Regex::new(r"^\s*(?i:betreff|subject)\s*:\s*(.+?)\s*(\r?\n|$)")
            .expect("static subject regex is valid")
    });

    let mut body = text;
    let mut subject = "";
    if let Some(captures) = regex.captures(text) {
        let whole = captures.get(0).expect("whole capture exists");
        subject = captures.get(1).map_or("", |value| value.as_str());
        body = &text[whole.end()..];
        body = php_ltrim(body);
    }

    SubjectSplit {
        subject: if want_subject {
            php_trim(subject).to_owned()
        } else {
            String::new()
        },
        body: php_trim(body).to_owned(),
    }
}

pub fn php_ltrim(text: &str) -> &str {
    text.trim_start_matches(is_php_whitespace)
}

pub fn php_trim(text: &str) -> &str {
    text.trim_matches(is_php_whitespace)
}

fn is_php_whitespace(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\r' | '\0' | '\u{0b}')
}

pub fn trim_php_bytes(bytes: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && is_php_byte(bytes[start]) {
        start += 1;
    }
    while end > start && is_php_byte(bytes[end - 1]) {
        end -= 1;
    }
    &bytes[start..end]
}

fn is_php_byte(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0 | 0x0b)
}

#[cfg(test)]
mod tests {
    use super::{php_trim, split_subject};

    #[test]
    fn matches_legacy_subject_and_whitespace_behavior() {
        assert_eq!(
            split_subject(" \nBetreff: Grüße ✓\r\n\r\n Text ", true),
            super::SubjectSplit {
                subject: "Grüße ✓".into(),
                body: "Text".into()
            }
        );
        assert_eq!(
            split_subject("Subject: Hidden\nText", false),
            super::SubjectSplit {
                subject: String::new(),
                body: "Text".into()
            }
        );
        assert_eq!("Nur Text", split_subject("Nur Text", true).body);
        assert_eq!("Betreff", split_subject("Subject: Betreff", true).subject);
        assert_eq!("\u{a0}", php_trim("\u{a0}"));
    }
}
