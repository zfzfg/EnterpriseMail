use serde::Serialize;

/// A deliberately sanitized error that is safe to expose as a downstream SSE event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyError {
    pub code: &'static str,
    pub message: String,
}

impl ProxyError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn body_too_large() -> Self {
        Self::new("body_too_large", "Die Anfrage ist zu groß.")
    }

    pub fn invalid_request() -> Self {
        Self::new("invalid_request", "Ungültige Anfrage.")
    }

    pub fn invalid_json() -> Self {
        Self::new("invalid_json", "Ungültiges JSON.")
    }

    pub fn invalid_content_type() -> Self {
        Self::new(
            "invalid_content_type",
            "Content-Type muss application/json sein.",
        )
    }

    pub fn busy() -> Self {
        Self::new(
            "busy",
            "Der Dienst ist ausgelastet, bitte später erneut versuchen.",
        )
    }

    pub fn prepare_timeout() -> Self {
        Self::new(
            "prepare_timeout",
            "Zeitüberschreitung bei der Anfragevorbereitung.",
        )
    }

    pub fn prepare_unavailable() -> Self {
        Self::new(
            "prepare_unavailable",
            "Die Anfragevorbereitung ist nicht erreichbar.",
        )
    }

    pub fn invalid_prepare_response() -> Self {
        Self::new(
            "invalid_prepare_response",
            "Die Anfragevorbereitung hat eine ungültige Antwort gesendet.",
        )
    }

    pub fn prepare_failed() -> Self {
        Self::new(
            "prepare_failed",
            "Die Anfragevorbereitung ist fehlgeschlagen.",
        )
    }

    pub fn provider_not_configured() -> Self {
        Self::new(
            "provider_not_configured",
            "Der Anbieter ist nicht gültig konfiguriert.",
        )
    }

    pub fn upstream_timeout() -> Self {
        Self::new("upstream_timeout", "Zeitüberschreitung beim Anbieter.")
    }

    pub fn upstream_unavailable() -> Self {
        Self::new("upstream_unavailable", "Der Anbieter ist nicht erreichbar.")
    }

    pub fn upstream_too_large() -> Self {
        Self::new(
            "upstream_too_large",
            "Die Antwort des Anbieters überschreitet das Größenlimit.",
        )
    }

    pub fn upstream_malformed_json() -> Self {
        Self::new(
            "upstream_malformed_json",
            "Der Anbieter hat ungültiges JSON gesendet.",
        )
    }

    pub fn upstream_incomplete() -> Self {
        Self::new(
            "upstream_incomplete",
            "Die Antwort des Anbieters war unvollständig.",
        )
    }

    pub fn upstream_error() -> Self {
        Self::new(
            "upstream_error",
            "Der Anbieter hat den Vorgang abgebrochen.",
        )
    }

    pub fn upstream_http(status: u16) -> Self {
        let detail = match status {
            401 | 403 => "API-Key ungültig oder fehlt",
            404 => "Modell oder Endpunkt nicht gefunden",
            413 => "Anfrage zu groß",
            429 => "Zu viele Anfragen oder Kontingent erschöpft, bitte kurz warten",
            500..=599 => "Fehler beim Anbieter",
            _ => "Anfrage abgelehnt",
        };
        Self::new("upstream_http", format!("{detail} (HTTP {status})"))
    }

    pub fn internal() -> Self {
        Self::new("internal_error", "Interner Fehler.")
    }

    /// Maps only explicit, public prepare error codes. Prepare response text is never forwarded.
    pub fn from_prepare_code(code: &str) -> Option<Self> {
        let error = match code {
            "method_not_allowed" => Self::new("method_not_allowed", "Nur POST erlaubt."),
            "prepare_forbidden" => Self::new(
                "prepare_forbidden",
                "Die Anfragevorbereitung wurde abgelehnt.",
            ),
            "prepare_disabled" => {
                Self::new("prepare_disabled", "Der Streaming-Dienst ist deaktiviert.")
            }
            "provider_not_eligible" => Self::new(
                "provider_not_eligible",
                "Dieses Anbieterprofil verwendet PHP-Streaming.",
            ),
            "cross_site_request" => {
                Self::new("cross_site_request", "Herkunft der Anfrage nicht erlaubt.")
            }
            "invalid_csrf" => Self::new("invalid_csrf", "Ungültiges Token."),
            "unauthenticated" => Self::new(
                "unauthenticated",
                "Nicht angemeldet oder Sitzung abgelaufen.",
            ),
            "feature_disabled" => Self::new("feature_disabled", "Die Funktion ist deaktiviert."),
            "consent_required" => Self::new("consent_required", "Einwilligung erforderlich."),
            "body_too_large" => Self::body_too_large(),
            "invalid_content_type" => Self::invalid_content_type(),
            "invalid_json" => Self::invalid_json(),
            "invalid_request" => Self::invalid_request(),
            "invalid_mode" => Self::new("invalid_mode", "Ungültiger Entwurfsmodus."),
            "invalid_field" => Self::new(
                "invalid_field",
                "Ungültiger oder zu langer Anfrageparameter.",
            ),
            "invalid_uids" => Self::new("invalid_uids", "Ungültige UID-Liste."),
            "provider_not_configured" => Self::provider_not_configured(),
            "provider_unavailable" => Self::upstream_unavailable(),
            "upstream_timeout" => Self::upstream_timeout(),
            "upstream_too_large" => Self::upstream_too_large(),
            _ => return None,
        };
        Some(error)
    }
}

#[derive(Serialize)]
pub struct ErrorEvent<'a> {
    pub error: &'a str,
    pub code: &'static str,
}

impl ProxyError {
    pub fn event(&self) -> ErrorEvent<'_> {
        ErrorEvent {
            error: &self.message,
            code: self.code,
        }
    }
}
