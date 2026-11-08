use serde_json::{Map, Value};

use crate::error::ProxyError;

pub const MAX_BROWSER_BODY_BYTES: usize = 65_536;
pub const MAX_UIDS: usize = 100;
const FIELDS: [&str; 9] = [
    "mode",
    "tone",
    "instruction",
    "current",
    "wantSubject",
    "folder",
    "uids",
    "uid",
    "sent",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftRequest {
    pub mode: String,
    pub tone: String,
    pub instruction: String,
    pub current: String,
    pub want_subject: bool,
    pub folder: String,
    pub uids: Vec<u32>,
    pub sent: String,
}

pub fn decode(body: &[u8], content_type: &str) -> Result<DraftRequest, ProxyError> {
    if !is_json_content_type(content_type) {
        return Err(ProxyError::invalid_content_type());
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| ProxyError::invalid_json())?;
    let object = value.as_object().ok_or_else(ProxyError::invalid_request)?;
    validate(object)
}

fn validate(object: &Map<String, Value>) -> Result<DraftRequest, ProxyError> {
    if object.keys().any(|key| !FIELDS.contains(&key.as_str())) {
        return Err(ProxyError::invalid_request());
    }

    let mode = string_field(object, "mode", "new", 20)?;
    if !matches!(mode.as_str(), "new" | "reply" | "rewrite" | "proofread") {
        return Err(ProxyError::new("invalid_mode", "Ungültiger Entwurfsmodus."));
    }
    let want_subject = match object.get("wantSubject") {
        None => false,
        Some(Value::Bool(value)) => *value,
        _ => {
            return Err(ProxyError::new(
                "invalid_field",
                "Ungültiger Anfrageparameter.",
            ));
        }
    };

    let mut uids = Vec::new();
    if let Some(value) = object.get("uids") {
        let list = value.as_array().ok_or_else(invalid_uids)?;
        if list.len() > MAX_UIDS {
            return Err(invalid_uids());
        }
        for value in list {
            uids.push(parse_uid(value, false)?);
        }
    }
    if let Some(value) = object.get("uid") {
        let uid = parse_uid(value, true)?;
        if uid > 0 {
            uids.push(uid);
        }
    }
    let mut unique = Vec::with_capacity(uids.len());
    for uid in uids {
        if !unique.contains(&uid) {
            unique.push(uid);
        }
    }

    Ok(DraftRequest {
        mode,
        tone: string_field(object, "tone", "", 200)?,
        instruction: string_field(object, "instruction", "", 2000)?,
        current: string_field(object, "current", "", 8000)?,
        want_subject,
        folder: string_field(object, "folder", "", 512)?,
        uids: unique,
        sent: string_field(object, "sent", "", 512)?,
    })
}

fn string_field(
    object: &Map<String, Value>,
    key: &str,
    default: &str,
    maximum_characters: usize,
) -> Result<String, ProxyError> {
    let value = match object.get(key) {
        None => default,
        Some(Value::String(value)) => value,
        _ => return Err(invalid_field()),
    };
    if value.chars().count() > maximum_characters {
        return Err(invalid_field());
    }
    Ok(value.to_owned())
}

fn parse_uid(value: &Value, allow_zero: bool) -> Result<u32, ProxyError> {
    let number = value.as_u64().ok_or_else(invalid_uids)?;
    let minimum = if allow_zero { 0 } else { 1 };
    if number < minimum || number > u64::from(u32::MAX) {
        return Err(invalid_uids());
    }
    Ok(number as u32)
}

fn invalid_uids() -> ProxyError {
    ProxyError::new("invalid_uids", "Ungültige UID-Liste.")
}

fn invalid_field() -> ProxyError {
    ProxyError::new(
        "invalid_field",
        "Ungültiger oder zu langer Anfrageparameter.",
    )
}

pub fn is_json_content_type(content_type: &str) -> bool {
    let mut parts = content_type.split(';');
    if !parts
        .next()
        .is_some_and(|part| part.trim().eq_ignore_ascii_case("application/json"))
    {
        return false;
    }
    parts.all(|part| {
        let part = part.trim();
        if part.is_empty() {
            return true;
        }
        let Some((name, value)) = part.split_once('=') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case("charset")
            && value.trim().trim_matches('"').eq_ignore_ascii_case("utf-8")
            && !value.contains('=')
    })
}

#[cfg(test)]
mod tests {
    use super::{decode, is_json_content_type, MAX_BROWSER_BODY_BYTES};

    #[test]
    fn accepts_and_normalizes_legacy_draft_json() {
        let request = decode(
            r#"{"mode":"reply","tone":"freundlich ✓","instruction":"Kurz","current":"Text","wantSubject":true,"folder":"INBOX","uids":[1,2,1,4294967295],"uid":3,"sent":"Sent"}"#.as_bytes(),
            "application/json; charset=UTF-8",
        )
        .expect("valid request");
        assert_eq!(vec![1, 2, u32::MAX, 3], request.uids);
        assert!(request.want_subject);
        assert_eq!("reply", request.mode);
    }

    #[test]
    fn rejects_malformed_unknown_and_oversized_input() {
        assert_eq!(
            "invalid_json",
            decode(b"{", "application/json").unwrap_err().code
        );
        assert_eq!(
            "invalid_request",
            decode(b"[]", "application/json").unwrap_err().code
        );
        assert_eq!(
            "invalid_request",
            decode(
                br#"{"provider_url":"https://attacker.invalid"}"#,
                "application/json"
            )
            .unwrap_err()
            .code
        );
        assert_eq!(
            "invalid_uids",
            decode(br#"{"uids":[1.0]}"#, "application/json")
                .unwrap_err()
                .code
        );
        const {
            assert!(MAX_BROWSER_BODY_BYTES == 65_536);
        }
    }

    #[test]
    fn content_type_compatibility_is_strict() {
        assert!(is_json_content_type("APPLICATION/JSON"));
        assert!(is_json_content_type("application/json; charset=utf-8"));
        for content_type in [
            "text/plain",
            "application/json-patch+json",
            "application/json; charset=iso-8859-1",
            "application/json; boundary=x",
            "",
        ] {
            assert!(!is_json_content_type(content_type));
        }
    }
}
